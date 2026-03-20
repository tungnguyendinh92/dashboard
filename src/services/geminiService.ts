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
  }[];
}

export const parseExcelDataWithAI = async (rawData: any[], mode: 'replace' | 'update' = 'replace') => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Gemini API Key is not configured. Please add GEMINI_API_KEY to your environment variables.");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Process in chunks to avoid timeouts and token limits
  const CHUNK_SIZE = 150; 
  const chunks = [];
  for (let i = 0; i < rawData.length; i += CHUNK_SIZE) {
    chunks.push(rawData.slice(i, i + CHUNK_SIZE));
  }

  // Only process first 3 chunks (450 rows) to keep it responsive, or all if needed
  // Let's do up to 600 rows (4 chunks)
  const chunksToProcess = chunks.slice(0, 4);
  const allResults: NPITask[] = [];

  for (const [index, chunk] of chunksToProcess.entries()) {
    const prompt = `
      Analyze the following raw data (Chunk ${index + 1}/${chunksToProcess.length}) extracted from an NPI schedule Excel file.
      Identify the header row (if present in this chunk) and extract all project/part items.
      
      Extract the following fields for each item:
      - project, projectDescription, partNo, molder, odm, currentStage, latestStatus
      - startDate, endDate (YYYY-MM-DD)
      - milestones: { beta, pilotRun, mp, xf }
      - timelinePoints: { toolingStart, t1, t2, t3, t4, t5 }
      - issues: Array of { trial, description, status, severity }
      
      IMPORTANT: Process ALL rows in this chunk that contain actual data.
      Each item must have a unique 'id'. Generate it using project, partNo, and chunk index.
      
      Raw Data (Rows): ${JSON.stringify(chunk)}
    `;

    try {
      // 45 second timeout per chunk
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`AI Request Timeout on chunk ${index + 1}`)), 45000)
      );

      const generatePromise = ai.models.generateContent({
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
                      severity: { type: Type.STRING, enum: ['low', 'medium', 'high'] }
                    }
                  }
                }
              },
              required: ['id', 'project', 'projectDescription', 'partNo', 'startDate', 'endDate']
            }
          }
        }
      });

      const response = (await Promise.race([generatePromise, timeoutPromise])) as any;
      const text = response.text;
      if (text) {
        const chunkResults = JSON.parse(text) as NPITask[];
        allResults.push(...chunkResults);
      }
    } catch (error) {
      console.error(`Error parsing chunk ${index + 1}:`, error);
      // Continue to next chunk even if one fails
    }
  }

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
