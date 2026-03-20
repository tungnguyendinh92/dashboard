import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Google OAuth Setup
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/auth/google/callback`
  );

  app.get("/api/auth/google/url", (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/userinfo.profile"],
      prompt: "consent"
    });
    res.json({ url });
  });

  app.get("/auth/google/callback", async (req, res) => {
    const { code } = req.query;
    try {
      const { tokens } = await oauth2Client.getToken(code as string);
      // In a real app, you'd store tokens in a session/DB
      // For this demo, we'll send them back to the client to store in localStorage (not secure for production, but okay for this prototype)
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>Authentication successful. Closing window...</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error("Error exchanging code for tokens:", error);
      res.status(500).send("Authentication failed");
    }
  });

  // Google Sheets API Endpoints
  app.post("/api/sheets/sync", async (req, res) => {
    const { tokens, spreadsheetId, data } = req.body;
    if (!tokens || !spreadsheetId || !data) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const auth = new google.auth.OAuth2();
      auth.setCredentials(tokens);
      const sheets = google.sheets({ version: "v4", auth });

      // Prepare data for sheets
      const values = [
        ["Task", "Start Date", "End Date", "Status", "Owner", "Progress"],
        ...data.map((item: any) => [
          item.task,
          item.startDate,
          item.endDate,
          item.status,
          item.owner,
          item.progress
        ])
      ];

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "Sheet1!A1",
        valueInputOption: "RAW",
        requestBody: { values },
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Sheets sync error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
