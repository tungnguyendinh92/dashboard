import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface NPITask {
  id: string;
  task: string;
  startDate: string;
  endDate: string;
  status: 'Pending' | 'In Progress' | 'Completed' | 'Delayed';
  owner: string;
  progress: number;
}

export const parseExcelDataWithAI = async (rawData: any[]) => {
  const prompt = `
    Analyze the following data extracted from an NPI (New Product Introduction) schedule Excel file.
    Convert it into a structured JSON array of tasks.
    Each task must have: id (unique string), task (name), startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), status (Pending, In Progress, Completed, Delayed), owner, and progress (0-100).
    
    Raw Data: ${JSON.stringify(rawData.slice(0, 50))}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              task: { type: Type.STRING },
              startDate: { type: Type.STRING },
              endDate: { type: Type.STRING },
              status: { type: Type.STRING, enum: ['Pending', 'In Progress', 'Completed', 'Delayed'] },
              owner: { type: Type.STRING },
              progress: { type: Type.NUMBER }
            },
            required: ['id', 'task', 'startDate', 'endDate', 'status', 'owner', 'progress']
          }
        }
      }
    });

    return JSON.parse(response.text) as NPITask[];
  } catch (error) {
    console.error("AI Parsing Error:", error);
    return [];
  }
};

export const askAIAboutSchedule = async (tasks: NPITask[], question: string) => {
  const prompt = `
    You are an expert NPI Project Manager. Below is the current NPI schedule data.
    Answer the user's question based on this data. Be concise and professional.
    
    Schedule Data: ${JSON.stringify(tasks)}
    
    Question: ${question}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    return response.text;
  } catch (error) {
    console.error("AI Question Error:", error);
    return "Sorry, I couldn't process that question.";
  }
};
