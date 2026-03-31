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

  // Process all chunks to ensure no data is missed
  const allResults: NPITask[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("AI Request Timeout")), 60000));
    const prompt = `
      You are a professional NPI Data Analyst. Your task is to extract high-precision data from an NPI schedule Excel file.
      
      STRICT COLUMN MAPPING RULES (MANDATORY):
      - Project Name: Column A (Required)
      - Project Description: Column B
      - Part Number: Column C (Required)
      - Molder: Column D
      - ODM: Column E
      - Current Stage: Column F
      - Latest Status/Issues: Column G (Crucial for issue extraction)
      - Start Date: Column H (Format: YYYY-MM-DD or similar)
      - End Date: Column J (Format: YYYY-MM-DD or similar)
      - DFM: Column U
      - Tooling Start: Column I
      - T1: Column V
      - T2: Column W
      - T3: Column X
      - T4: Column Y
      - T5: Column Z
      - Beta Milestone: Column AA
      - Pilot Run Milestone: Column AB
      - MP Milestone: Column AC
      - XF Milestone: Column AD

      EXTRACT FOR EACH ITEM:
      - project, projectDescription, partNo, molder, odm, currentStage, latestStatus
      - ALL DATES (startDate, endDate, milestones, timelinePoints) MUST BE IN Format: YYYY-MM-DD.
      - milestones: { beta, pilotRun, mp, xf }
      - timelinePoints: { dfm, toolingStart, t1, t2, t3, t4, t5 }
      
      ISSUE EXTRACTION RULES:
      - Scan Column G (Latest Status/Issues) and prioritize information associated with the LATEST 'T' trial mentioned (e.g., if T4 and T5 are both mentioned, T5 is the latest update).
      - Split by bullet points, newlines, or semicolons.
      - For each issue, identify:
        - trial: which trial it belongs to (e.g., T1, T2, Beta)
        - description: the actual problem
        - status: 'open' (if not mentioned as fixed/closed) or 'closed'
        - severity: 'low', 'medium', or 'high' (based on keywords like 'critical', 'major', 'minor')
        - category: MUST be one of ['Function', 'Cosmetic', 'ECN', 'Other']
      
      ISSUE CATEGORIZATION LOGIC:
      - 'Function': Mechanical/Electrical performance, fit, function, dimension out of spec, assembly issues.
      - 'Cosmetic': Surface finish, color, texture, appearance, scratches, sink marks, flash.
      - 'ECN': Engineering changes, design updates, drawing revisions.
      - 'Other': Logistics, material availability, or anything else.
      
      IMPORTANT: 
      - DO NOT SKIP ANY ROW that contains part data or project names.
      - If a row has a Project Name (Column A) or a Part Number (Column C), it MUST be processed.
      - If a date is missing or invalid, leave it null/undefined.
      - Process ALL rows in the provided chunk.
      - Each item must have a unique 'id' (combine project and partNo if needed). 
      
      Raw Data (Rows): ${JSON.stringify(chunk)}
    `;

    try {
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
              required: ['id', 'project', 'partNo']
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
