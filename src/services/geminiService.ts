import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

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
  const prompt = `
    Analyze the following data extracted from an NPI (New Product Introduction) schedule Excel file.
    Convert it into a structured JSON array of projects/parts.
    
    Extract the following fields for each item:
    - project: The main project name (e.g., "RBE300Y", "Project Alpha"). Look for codes or names that represent the overall project.
    - projectDescription: Description of the project or part tool.
    - partNo: Part number.
    - molder: Molder name.
    - odm: ODM name.
    - currentStage: Current stage of the project.
    - latestStatus: Latest status update.
    - startDate: The earliest date found for this item (YYYY-MM-DD).
    - endDate: The latest date found for this item (YYYY-MM-DD).
    - milestones: Object containing dates for 'beta', 'pilotRun', 'mp', 'xf' (YYYY-MM-DD).
    - timelinePoints: Object containing dates for 'toolingStart', 't1', 't2', 't3', 't4', 't5' (YYYY-MM-DD).
    - issues: Array of objects with 'trial', 'description', 'status', 'severity' (if found).

    IMPORTANT: Ensure project names like "RBE300Y" are correctly identified and not split or ignored.
    
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
    
    If the user asks to modify data (e.g., "Change T1 of Project X to 2024-05-01"), 
    you must return a JSON object in your response with the following structure:
    {
      "answer": "Your human-like response here",
      "updates": [
        { "id": "task-id", "field": "path.to.field", "value": "new-value" }
      ]
    }
    Otherwise, just return your text answer.

    Schedule Data: ${JSON.stringify(tasks)}
    
    Question: ${question}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
    });
    
    try {
      return JSON.parse(response.text);
    } catch {
      return { answer: response.text };
    }
  } catch (error) {
    console.error("AI Question Error:", error);
    return { answer: "Sorry, I couldn't process that question." };
  }
};
