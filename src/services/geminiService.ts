import { GoogleGenAI, Type } from "@google/genai";

const getApiKey = () => {
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
  ].filter(Boolean) as string[];
  
  if (keys.length === 0) return null;
  // Random selection to distribute load/quota
  return keys[Math.floor(Math.random() * keys.length)];
};

export interface NPITask {
  id: string;
  project: string; // Grouping key
  projectDescription: string;
  partNo: string;
  molder: string;
  odm: string;
  currentStage: string;
  latestStatus: string;
  startDate: string; 
  endDate: string;
  milestones: {
    beta?: string;
    pilotRun?: string;
    mp?: string;
    xf?: string;
  };
  timelinePoints: {
    dfm?: string;
    toolingStart?: string;
    t1?: string;
    t2?: string;
    t3?: string;
    t4?: string;
    t5?: string;
  };
  issues?: {
    trial: string;
    description: string;
    status: 'open' | 'closed';
    severity: 'low' | 'medium' | 'high';
    category: 'Function' | 'Cosmetic' | 'ECN' | 'Other';
  }[];
}

export const parseExcelDataWithAI = async (rawData: any[], onProgress?: (msg: string) => void) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Gemini API Key is not configured. Please add GEMINI_API_KEY to your environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Filter out completely empty rows or rows that are obviously headers/empty
  const filteredData = rawData.filter(row => {
    if (!Array.isArray(row)) return false;
    // A row is valid if it has at least some content in the first few columns
    return row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
  });

  // Process in smaller chunks to ensure the AI can return ALL items without hitting output token limits
  // 40-50 rows is a safe bet for high-precision extraction with a large schema
  const CHUNK_SIZE = 40; 
  const chunks = [];
  for (let i = 0; i < filteredData.length; i += CHUNK_SIZE) {
    chunks.push(filteredData.slice(i, i + CHUNK_SIZE));
  }

  if (onProgress) onProgress(`Processing ${filteredData.length} rows in ${chunks.length} chunks...`);
  console.log(`Processing ${filteredData.length} rows in ${chunks.length} chunks...`);

  const allResults: NPITask[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const msg = `Processing chunk ${index + 1}/${chunks.length}...`;
    if (onProgress) onProgress(msg);
    console.log(msg);
    
    // Increased timeout for large chunks
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("AI Request Timeout")), 90000));
    
    const prompt = `
      You are a professional NPI Data Analyst. Your task is to extract high-precision data from an NPI schedule Excel file.
      The data is provided as an array of arrays, where each inner array represents a row.
      
      STRICT COLUMN MAPPING RULES (MANDATORY):
      - Project Name: Column A (Index 0) - Required
      - Project Description: Column B (Index 1)
      - Part Number: Column C (Index 2) - Required
      - Molder: Column D (Index 3)
      - ODM: Column E (Index 4)
      - Current Stage: Column F (Index 5)
      - Latest Status/Issues: Column G (Index 6) - Crucial for issue extraction
      - Start Date: Column H (Index 7)
      - End Date: Column J (Index 9)
      - Tooling Start: Column I (Index 8)
      - DFM: Column U (Index 20)
      - T1: Column V (Index 21)
      - T2: Column W (Index 22)
      - T3: Column X (Index 23)
      - T4: Column Y (Index 24)
      - T5: Column Z (Index 25)
      - Beta Milestone: Column AA (Index 26)
      - Pilot Run Milestone: Column AB (Index 27)
      - MP Milestone: Column AC (Index 28)
      - XF Milestone: Column AD (Index 29)

      EXTRACTION REQUIREMENTS:
      1. For EACH ROW that has a Part Number (Col C), you MUST create one entry.
      2. If a row is missing a Project Name (Col A), use the Project Name from the most recent row above it that HAD a Project Name. This is a common Excel grouping pattern.
      3. ALL DATES MUST BE in YYYY-MM-DD format. If the input is a serial number (Excel date), convert it.
      4. latestStatus: Capture the full text from Column G.
      5. issues: Extract individual issues from Column G. 
         - Prioritize the LATEST 'T' trial mentioned (e.g., T5 status over T4).
         - If an issue is marked as [SOLVED] or "Resolved", set status to 'closed'. Otherwise 'open'.
         - Category MUST be one of: ['Function', 'Cosmetic', 'ECN', 'Other'].
      
      IMPORTANT: 
      - DO NOT SKIP ANY DATA ROW.
      - If a row looks like a header (e.g., contains "Project Name", "Part No"), skip it.
      - Each item must have a unique 'id' (combine project and partNo if needed).
      - Return an empty array [] if no valid data rows are found in this chunk.
      
      Raw Data Chunk: ${JSON.stringify(chunk)}
    `;

    try {
      const response = await Promise.race([
        ai.models.generateContent({
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
                  project: { type: Type.STRING },
                  projectDescription: { type: Type.STRING },
                  partNo: { type: Type.STRING },
                  molder: { type: Type.STRING },
                  odm: { type: Type.STRING },
                  currentStage: { type: Type.STRING },
                  latestStatus: { type: Type.STRING },
                  startDate: { type: Type.STRING },
                  endDate: { type: Type.STRING },
                  milestones: {
                    type: Type.OBJECT,
                    properties: {
                      beta: { type: Type.STRING },
                      pilotRun: { type: Type.STRING },
                      mp: { type: Type.STRING },
                      xf: { type: Type.STRING }
                    }
                  },
                  timelinePoints: {
                    type: Type.OBJECT,
                    properties: {
                      dfm: { type: Type.STRING },
                      toolingStart: { type: Type.STRING },
                      t1: { type: Type.STRING },
                      t2: { type: Type.STRING },
                      t3: { type: Type.STRING },
                      t4: { type: Type.STRING },
                      t5: { type: Type.STRING }
                    }
                  },
                  issues: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        trial: { type: Type.STRING },
                        description: { type: Type.STRING },
                        status: { type: Type.STRING, enum: ['open', 'closed'] },
                        severity: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
                        category: { type: Type.STRING, enum: ['Function', 'Cosmetic', 'ECN', 'Other'] }
                      }
                    }
                  }
                },
                required: ['project', 'partNo']
              }
            }
          }
        }),
        timeoutPromise
      ]) as any;

      const text = response.text;
      if (text) {
        const chunkResults = JSON.parse(text) as NPITask[];
        console.log(`Chunk ${index + 1} parsed successfully. Found ${chunkResults.length} items.`);
        allResults.push(...chunkResults);
      }
    } catch (error) {
      console.error(`Error parsing chunk ${index + 1}:`, error);
    }
  }

  console.log(`Extraction complete. Total items found: ${allResults.length}`);
  return allResults;
};

export const askAIAboutSchedule = async (tasks: NPITask[], projectNotes: Record<string, string>, question: string) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { 
      answer: "Gemini API Key is missing. Please add GEMINI_API_KEY to your environment variables.", 
      updates: [] 
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
    You are an expert NPI Project Manager. Below is the current NPI schedule data and project overview notes.
    Answer the user's question based on this data. Be concise and professional.
    
    If the user asks to modify data (e.g., "Change T1 of Project X to 2024-05-01"), 
    you must return a JSON object in your response with the following structure:
    {
      "answer": "Your human-like response here",
      "updates": [
        { "id": "task-id", "field": "path.to.field", "value": "new-value" }
      ]
    }
    IMPORTANT: The "field" must be a valid path in the task object, e.g., "project", "latestStatus", "timelinePoints.t1", "milestones.mp".
    Ensure you use the correct "id" from the schedule data.
    
    If the user is just asking a question, you should still return a JSON object with "answer" field and an empty "updates" array.
    {
      "answer": "Your response here",
      "updates": []
    }

    Schedule Data: ${JSON.stringify(tasks)}
    Project Overview/Notes: ${JSON.stringify(projectNotes)}
    
    Question: ${question}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });
    
    const text = response.text;
    if (!text) throw new Error("AI returned an empty response.");
    
    return JSON.parse(text);
  } catch (error: any) {
    console.error("AI Question Error:", error);
    return { 
      answer: `Sorry, I couldn't process that question. ${error?.message || "Unknown error"}`, 
      updates: [] 
    };
  }
};
