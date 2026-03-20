import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  Upload, FileSpreadsheet, Calendar, LayoutDashboard, MessageSquare, 
  Settings, CheckCircle2, Clock, AlertCircle, ChevronRight, Send,
  RefreshCw, Share2, LogIn, Volume2, VolumeX
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, parseISO, differenceInDays, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, isValid } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { parseExcelDataWithAI, askAIAboutSchedule, NPITask } from './services/geminiService';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

export default function App() {
  const [tasks, setTasks] = useState<NPITask[]>([]);
  const [prevTasks, setPrevTasks] = useState<NPITask[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'timeline' | 'table' | 'ai' | 'issues'>('dashboard');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [googleSheetUrl, setGoogleSheetUrl] = useState(() => 
    localStorage.getItem('google_sheet_url') || 'https://docs.google.com/spreadsheets/d/1LdjZm2Wd3c9FM1fkEg75c1SCAOqDux5iYaHpESxifuA/edit?usp=sharing'
  );
  const [googleScriptUrl, setGoogleScriptUrl] = useState(() => 
    localStorage.getItem('google_script_url') || 'https://script.google.com/macros/s/AKfycbyZ98rLVMd0pNMuoiH5eBdTLZ8Vj-KIRn5w2ZA4NTBJZqpnqUH2-wn7c1163ImNJF2Jyg/exec'
  );
  const [showSettings, setShowSettings] = useState(false);
  const [showAISidebar, setShowAISidebar] = useState(true);
  const [filterText, setFilterText] = useState('');
  const [projectNotes, setProjectNotes] = useState<Record<string, string>>({});
  const [editingTask, setEditingTask] = useState<NPITask | null>(null);
  const [isSilent, setIsSilent] = useState(() => localStorage.getItem('ai_silent') === 'true');
  const timelineRef = useRef<HTMLDivElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    const savedTasks = localStorage.getItem('npi_tasks');
    if (savedTasks) {
      const parsed = JSON.parse(savedTasks);
      setTasks(parsed);
      setPrevTasks(parsed);
    }
    
    const savedNotes = localStorage.getItem('project_notes');
    if (savedNotes) setProjectNotes(JSON.parse(savedNotes));

    // Auto-sync from Google Sheet on load
    if (googleScriptUrl) {
      fetchFromGoogleSheet();
    }
  }, []);

  // Save to localStorage when data changes
  useEffect(() => {
    if (tasks.length > 0) localStorage.setItem('npi_tasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem('project_notes', JSON.stringify(projectNotes));
  }, [projectNotes]);

  useEffect(() => {
    localStorage.setItem('ai_silent', isSilent.toString());
  }, [isSilent]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, mode: 'replace' | 'update') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        if (!data) throw new Error("No data read from file");
        
        const wb = XLSX.read(data, { type: 'array' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        // Use raw rows (header: 1) to be more robust for AI parsing
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        
        if (rawRows.length === 0) {
          alert("The Excel file seems to be empty.");
          return;
        }

        const parsedTasksRaw = await parseExcelDataWithAI(rawRows);
        
        // Post-process to ensure IDs are unique
        const idSet = new Set<string>();
        const parsedTasks = parsedTasksRaw.map((task, idx) => {
          let uniqueId = task.id || `${task.project}_${task.partNo}_${idx}`;
          if (idSet.has(uniqueId)) {
            uniqueId = `${uniqueId}_${idx}_${Date.now()}`;
          }
          idSet.add(uniqueId);
          return { ...task, id: uniqueId };
        });
        
        if (mode === 'replace') {
          setPrevTasks(tasks);
          setTasks(parsedTasks);
        } else {
          setTasks(prev => {
            const merged = [...prev];
            parsedTasks.forEach(newTask => {
              const index = merged.findIndex(t => t.id === newTask.id || (t.project === newTask.project && t.partNo === newTask.partNo));
              if (index > -1) {
                merged[index] = { ...merged[index], ...newTask };
              } else {
                merged.push(newTask);
              }
            });
            return merged;
          });
        }
      } catch (error) {
        console.error("File upload error:", error);
        alert("Failed to process file. Please ensure it's a valid Excel file and your Gemini API Key is configured.");
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => {
      setLoading(false);
      alert("Failed to read file.");
    };
    reader.readAsArrayBuffer(file);
  };

  const exportData = () => {
    const exportObj = {
      tasks,
      projectNotes,
      exportedAt: new Date().toISOString(),
      version: '1.1'
    };
    const dataStr = JSON.stringify(exportObj, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `npi_data_${format(new Date(), 'yyyyMMdd_HHmm')}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const importData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const content = evt.target?.result as string;
        const imported = JSON.parse(content);
        
        if (Array.isArray(imported)) {
          // Backward compatibility for old format
          setTasks(imported);
          alert("Data imported successfully (legacy format)!");
        } else if (imported && imported.tasks) {
          setTasks(imported.tasks);
          if (imported.projectNotes) setProjectNotes(imported.projectNotes);
          alert("Data and notes imported successfully!");
        } else {
          alert("Invalid JSON format.");
        }
      } catch (error) {
        console.error("Import error:", error);
        alert("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
  };

  const addSampleData = () => {
    const sampleTasks: NPITask[] = [
      {
        id: 'sample-1',
        project: 'Project Alpha',
        projectDescription: 'Main Chassis Tooling',
        partNo: 'CH-001',
        molder: 'Molder A',
        odm: 'ODM X',
        currentStage: 'T1',
        latestStatus: 'On track',
        startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(addDays(new Date(), 90), 'yyyy-MM-dd'),
        milestones: { beta: format(addDays(new Date(), 30), 'yyyy-MM-dd') },
        timelinePoints: { toolingStart: format(new Date(), 'yyyy-MM-dd'), t1: format(addDays(new Date(), 15), 'yyyy-MM-dd') }
      }
    ];
    setTasks(sampleTasks);
    alert("Sample data added!");
  };

  const filteredTasks = tasks.filter(t => 
    (t.project || '').toLowerCase().includes((filterText || '').toLowerCase()) ||
    (t.projectDescription || '').toLowerCase().includes((filterText || '').toLowerCase()) ||
    (t.partNo || '').toLowerCase().includes((filterText || '').toLowerCase())
  );

  const groupedTasks = filteredTasks.reduce((acc, task) => {
    if (!acc[task.project]) acc[task.project] = [];
    acc[task.project].push(task);
    return acc;
  }, {} as Record<string, NPITask[]>);

  const handleNoteChange = (id: string, note: string) => {
    setProjectNotes(prev => ({ ...prev, [id]: note }));
  };

  const isStatusUpdated = (task: NPITask) => {
    const prev = prevTasks.find(pt => pt.id === task.id);
    return prev && prev.latestStatus !== task.latestStatus;
  };

  const handleChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
    
    const aiResponse = await askAIAboutSchedule(tasks, userMsg);
    
    if (aiResponse.updates && aiResponse.updates.length > 0) {
      setTasks(prev => {
        const next = [...prev];
        aiResponse.updates.forEach((update: any) => {
          const taskIndex = next.findIndex(t => t.id === update.id);
          if (taskIndex > -1) {
            // Clone the task object to ensure re-render
            const updatedTask = { ...next[taskIndex] };
            const keys = update.field.split('.');
            let obj: any = updatedTask;
            for (let i = 0; i < keys.length - 1; i++) {
              obj[keys[i]] = { ...obj[keys[i]] };
              obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = update.value;
            next[taskIndex] = updatedTask;
          }
        });
        return next;
      });
    }

    setChatHistory(prev => [...prev, { role: 'ai', content: aiResponse.answer }]);
    speak(aiResponse.answer);
  };

  const speak = (text: string) => {
    if (isSilent) return;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    }
  };

  const clearData = () => {
    if (window.confirm("Are you sure you want to clear all data? This cannot be undone.")) {
      setTasks([]);
      setPrevTasks([]);
      setProjectNotes({});
      localStorage.removeItem('npi_tasks');
      localStorage.removeItem('project_notes');
    }
  };

  const handleTableEdit = (taskId: string, field: string, value: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const keys = field.split('.');
        const next = { ...t };
        let obj: any = next;
        for (let i = 0; i < keys.length - 1; i++) {
          obj[keys[i]] = { ...obj[keys[i]] };
          obj = obj[keys[i]];
        }
        obj[keys[keys.length - 1]] = value;
        return next;
      }
      return t;
    }));
  };

  const scrollToToday = () => {
    const performScroll = () => {
      const todayMarker = document.getElementById('today-marker');
      if (todayMarker && timelineRef.current) {
        todayMarker.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    };

    if (activeTab !== 'timeline') {
      setActiveTab('timeline');
      setTimeout(performScroll, 300);
    } else {
      performScroll();
    }
  };

  const uploadToGoogleSheet = async () => {
    if (!googleScriptUrl) {
      alert("Please set your Google Apps Script URL in Settings first.");
      setShowSettings(true);
      return;
    }
    
    setLoading(true);
    try {
      const response = await fetch(googleScriptUrl, {
        method: 'POST',
        mode: 'cors', // Try cors first for better feedback
        headers: { 'Content-Type': 'text/plain' }, // Use text/plain to avoid preflight issues if needed
        body: JSON.stringify({ 
          action: 'upload', 
          data: { 
            tasks, 
            projectNotes,
            updatedAt: new Date().toISOString()
          } 
        })
      });
      
      if (response.type === 'opaque') {
        alert("Data sent! (Note: Response was opaque due to CORS, but data should be uploaded)");
      } else {
        const result = await response.json();
        if (result.status === 'success') {
          alert("Data successfully uploaded to Google Sheet!");
        } else {
          throw new Error(result.error || "Unknown error from script");
        }
      }
    } catch (error: any) {
      console.error("Upload Error:", error);
      // Fallback for no-cors if cors fails
      try {
        await fetch(googleScriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: 'upload', data: tasks })
        });
        alert("Data sent via fallback mode! Check your Google Sheet.");
      } catch (fallbackError) {
        alert(`Failed to connect to Google Apps Script: ${error.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchFromGoogleSheet = async () => {
    if (!googleScriptUrl) {
      alert("Please set your Google Apps Script URL in Settings first.");
      setShowSettings(true);
      return;
    }
    
    setLoading(true);
    try {
      // Use a timestamp to avoid caching
      const url = new URL(googleScriptUrl);
      url.searchParams.append('action', 'download');
      url.searchParams.append('t', Date.now().toString());

      const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow'
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Network response was not ok: ${response.status} ${text}`);
      }

      const data = await response.json();
      if (data && data.tasks && Array.isArray(data.tasks)) {
        setTasks(data.tasks);
        if (data.projectNotes) setProjectNotes(data.projectNotes);
        alert("Data and notes synced from Google Sheet!");
      } else if (Array.isArray(data)) {
        // Backward compatibility
        setTasks(data);
        alert("Data synced from Google Sheet (legacy format)!");
      } else if (data && data.error) {
        throw new Error(data.error);
      } else {
        alert("Received invalid data format from script.");
      }
    } catch (error: any) {
      console.error("Fetch Error:", error);
      alert(`Failed to fetch data: ${error.message || "Unknown error"}. \n\nEnsure your script is deployed as a Web App with "Anyone" access and handles GET requests.`);
    } finally {
      setLoading(false);
    }
  };

  const stats = {
    totalProjects: Object.keys(groupedTasks).length,
    totalParts: filteredTasks.length,
    activeStages: new Set(filteredTasks.map(t => t.currentStage)).size,
    alerts: filteredTasks.filter(t => (t.latestStatus || '').toLowerCase().includes('delay')).length,
  };

  const stageData = Object.entries(
    filteredTasks.reduce((acc, t) => {
      acc[t.currentStage] = (acc[t.currentStage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name, value }));

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1C1E] font-sans">
      {/* Loading Overlay */}
      <AnimatePresence>
        {loading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center gap-4"
          >
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <p className="font-bold text-lg text-[#1A1C1E]">Processing Data with AI...</p>
              <p className="text-sm text-[#44474E]">This may take up to 30 seconds for large files.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-64 bg-white border-r border-[#E1E3E1] p-6 flex flex-col gap-8 z-20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#0061A4] rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
            <RefreshCw className="w-6 h-6" />
          </div>
          <h1 className="font-bold text-xl tracking-tight">NPI Flow</h1>
        </div>

        <nav className="flex flex-col gap-2">
          <NavItem active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard />} label="Dashboard" />
          <NavItem active={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')} icon={<Calendar />} label="Timeline" />
          <NavItem active={activeTab === 'table'} onClick={() => setActiveTab('table')} icon={<FileSpreadsheet />} label="Schedule Table" />
          <NavItem active={activeTab === 'issues'} onClick={() => setActiveTab('issues')} icon={<AlertCircle />} label="Issue List" />
        </nav>

        <div className="mt-auto space-y-2 pt-6 border-t border-[#E1E3E1]">
          <div className="grid grid-cols-2 gap-2">
            <button 
              onClick={exportData}
              className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-gray-50 hover:bg-gray-100 text-gray-600 transition-all"
              title="Export data to JSON file"
            >
              <Share2 className="w-4 h-4" />
              Export
            </button>
            <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-gray-50 hover:bg-gray-100 text-gray-600 transition-all cursor-pointer" title="Import data from JSON file">
              <Upload className="w-4 h-4" />
              Import
              <input type="file" accept=".json" onChange={importData} className="hidden" />
            </label>
          </div>
          <button 
            onClick={fetchFromGoogleSheet}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all font-medium"
          >
            <RefreshCw className="w-5 h-5" />
            Sync from Sheet
          </button>
          <button 
            onClick={uploadToGoogleSheet}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-blue-700 bg-blue-50 hover:bg-blue-100 transition-all font-medium"
          >
            <Share2 className="w-5 h-5" />
            Push to Sheet
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[#44474E] hover:bg-gray-100 transition-all font-medium"
          >
            <Settings className="w-5 h-5" />
            Settings
          </button>
          <button 
            onClick={clearData}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-red-600 hover:bg-red-50 transition-all font-medium"
          >
            <AlertCircle className="w-5 h-5" />
            Clear All Data
          </button>
        </div>
      </aside>

      {/* AI Sidebar Toggle Button (when hidden) */}
      {!showAISidebar && (
        <button 
          onClick={() => setShowAISidebar(true)}
          className="fixed right-0 top-1/2 -translate-y-1/2 bg-[#0061A4] text-white p-3 rounded-l-2xl z-30 shadow-xl hover:pr-6 transition-all"
          title="Show AI Assistant"
        >
          <MessageSquare className="w-6 h-6" />
        </button>
      )}

      {/* AI Sidebar */}
      <AnimatePresence>
        {showAISidebar && (
          <motion.aside 
            initial={{ x: 320 }}
            animate={{ x: 0 }}
            exit={{ x: 320 }}
            className="fixed right-0 top-0 h-full w-80 bg-white border-l border-[#E1E3E1] flex flex-col z-20 shadow-2xl"
          >
            <div className="p-6 border-b border-[#E1E3E1] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MessageSquare className="w-5 h-5 text-blue-600" />
                <h3 className="font-bold">AI Assistant</h3>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setIsSilent(!isSilent)}
                  className={`p-2 rounded-lg transition-colors ${isSilent ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600'}`}
                  title={isSilent ? "Unmute AI" : "Mute AI"}
                >
                  {isSilent ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <button 
                  onClick={() => setShowAISidebar(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatHistory.length === 0 && (
                <div className="text-center mt-10 text-gray-400 text-sm">
                  Ask me to analyze or modify the schedule.
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[90%] p-3 rounded-2xl text-sm ${
                    msg.role === 'user' ? 'bg-[#E3F2FD] text-[#0D47A1]' : 'bg-[#F0F4F8] text-[#1A1C1E]'
                  }`}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-[#E1E3E1]">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleChat()}
                  placeholder="Ask AI..."
                  className="flex-1 bg-[#F0F4F8] border-none rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button onClick={handleChat} className="bg-[#0061A4] text-white p-2 rounded-xl">
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className={`transition-all duration-300 ${showAISidebar ? 'mr-80' : 'mr-0'} ml-64 p-8 min-h-screen`}>
        {!process.env.GEMINI_API_KEY && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-3 text-amber-800 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p>
              <strong>Gemini API Key missing:</strong> AI features will not work. 
              If you deployed to Vercel, please add <code>GEMINI_API_KEY</code> to your environment variables.
            </p>
          </div>
        )}
        <header className="flex flex-col gap-6 mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-3xl font-bold text-[#1A1C1E]">NPI Schedule</h2>
              <p className="text-[#44474E]">Grouped by Projects & Trials.</p>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={addSampleData}
                className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-200 transition-all"
              >
                Add Sample Data
              </button>
              <label className="flex items-center gap-2 bg-[#0061A4] text-white px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer hover:bg-[#004A7D] transition-all shadow-lg shadow-blue-100">
                <RefreshCw className="w-4 h-4" />
                Replace Data
                <input type="file" accept=".xlsx, .xls" onChange={(e) => handleFileUpload(e, 'replace')} className="hidden" />
              </label>
              <label className="flex items-center gap-2 bg-white text-[#0061A4] border border-[#0061A4] px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer hover:bg-blue-50 transition-all">
                <RefreshCw className="w-4 h-4" />
                Update Data
                <input type="file" accept=".xlsx, .xls" onChange={(e) => handleFileUpload(e, 'update')} className="hidden" />
              </label>
            </div>
          </div>

          <div className="bg-white p-2 rounded-2xl border border-[#E1E3E1] flex items-center gap-3 shadow-sm">
            <div className="pl-4 text-gray-400"><LayoutDashboard className="w-5 h-5" /></div>
            <input 
              type="text" 
              placeholder="Filter by Project..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none py-2 text-sm"
            />
          </div>
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center h-[60vh]">
            <RefreshCw className="w-12 h-12 text-[#0061A4] animate-spin mb-4" />
            <p className="text-lg font-medium text-[#44474E]">Processing data...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] border-2 border-dashed border-[#C4C7C5] rounded-3xl bg-white">
            <FileSpreadsheet className="w-16 h-16 text-[#C4C7C5] mb-4" />
            <h3 className="text-xl font-bold text-[#1A1C1E]">No Data</h3>
            <p className="text-[#44474E]">Upload Excel to start.</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                  <StatCard label="Projects" value={stats.totalProjects} icon={<FileSpreadsheet className="text-blue-600" />} />
                  <StatCard label="Total Parts" value={stats.totalParts} icon={<CheckCircle2 className="text-emerald-600" />} />
                  <StatCard label="Active Stages" value={stats.activeStages} icon={<Clock className="text-blue-500" />} />
                  <StatCard label="Alerts" value={stats.alerts} icon={<AlertCircle className="text-red-500" />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-[#E1E3E1] shadow-sm">
                    <h3 className="text-lg font-bold mb-4">Stages Distribution</h3>
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={stageData}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" axisLine={false} tickLine={false} />
                          <YAxis axisLine={false} tickLine={false} />
                          <Tooltip cursor={{fill: '#f3f4f6'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                          <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-3xl border border-[#E1E3E1] shadow-sm flex flex-col justify-center items-center">
                    <h3 className="text-lg font-bold mb-4">Project Health</h3>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={stageData}
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {stageData.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-[#E1E3E1] shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-[#E1E3E1] flex justify-between items-center">
                    <h3 className="text-lg font-bold">Project Overview</h3>
                    <button 
                      onClick={scrollToToday}
                      className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 transition-all"
                    >
                      <Clock className="w-4 h-4" />
                      Go to Today
                    </button>
                  </div>
                  <div className="p-6 space-y-8">
                    {Object.entries(groupedTasks).map(([projectName, projectTasks]) => (
                      <div key={projectName} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pb-8 border-b border-[#F0F0F0] last:border-0">
                        <div className="lg:col-span-3">
                          <h4 className="font-bold text-[#1A1C1E] text-lg">{projectName}</h4>
                          <p className="text-xs text-gray-500 mb-2">{projectTasks.length} parts</p>
                          <div className="flex flex-wrap gap-1">
                            {Array.from(new Set(projectTasks.map(t => t.currentStage))).map(stage => (
                              <span key={stage} className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-[9px] font-bold uppercase">
                                {stage}
                              </span>
                            ))}
                          </div>
                        </div>
                        
                        <div className="lg:col-span-6">
                          {/* Show timeline for the first part of the project as a representative */}
                          <ProjectMiniTimeline task={projectTasks[0]} />
                        </div>

                        <div className="lg:col-span-4">
                          <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Project Notes</label>
                          <textarea 
                            placeholder="Add project notes, risks, or updates..."
                            value={projectNotes[projectName] || ''}
                            onChange={(e) => handleNoteChange(projectName, e.target.value)}
                            className="w-full min-h-[120px] bg-[#F8F9FA] border border-[#E1E3E1] rounded-2xl p-4 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize shadow-inner"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'timeline' && (
              <motion.div 
                key="timeline"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="bg-white rounded-3xl border border-[#E1E3E1] shadow-sm overflow-hidden"
              >
                <div className="p-6 border-b border-[#E1E3E1] flex justify-between items-center bg-white sticky top-0 z-50">
                  <div className="flex items-center gap-4">
                    <h3 className="text-lg font-bold">NPI Timeline</h3>
                    <button 
                      onClick={scrollToToday}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-xs font-bold hover:bg-blue-100 transition-all border border-blue-100"
                    >
                      <Clock className="w-4 h-4" />
                      Go to Today
                    </button>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-red-500"></div>
                      <span className="text-gray-500">Milestones</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                      <span className="text-gray-500">Timeline Points</span>
                    </div>
                  </div>
                </div>
                <div className="overflow-hidden" ref={timelineRef}>
                  <GanttChart tasks={filteredTasks} onEdit={setEditingTask} onUpdateTask={(updatedTask) => {
                    setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
                  }} />
                </div>
              </motion.div>
            )}

            {activeTab === 'table' && (
              <motion.div 
                key="table"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="bg-white rounded-3xl border border-[#E1E3E1] shadow-sm overflow-hidden"
              >
                <div className="overflow-auto max-h-[75vh] relative">
                  <table className="w-full text-left border-collapse min-w-[2800px]">
                    <thead className="bg-[#F0F4F8] sticky top-0 z-20">
                      <tr>
                        <th className="p-4 font-semibold text-sm sticky left-0 bg-[#F0F4F8] z-30 border-r border-[#E1E3E1] w-64">Project / Part Name</th>
                        <th className="p-4 font-semibold text-sm w-48">Part No</th>
                        <th className="p-4 font-semibold text-sm w-48">Molder</th>
                        <th className="p-4 font-semibold text-sm w-48">ODM</th>
                        <th className="p-4 font-semibold text-sm w-48">Stage</th>
                        <th className="p-4 font-semibold text-sm w-96">Status / Issues</th>
                        <th className="p-4 font-semibold text-sm w-32">Tooling Start</th>
                        <th className="p-4 font-semibold text-sm w-32">T1</th>
                        <th className="p-4 font-semibold text-sm w-32">T2</th>
                        <th className="p-4 font-semibold text-sm w-32">T3</th>
                        <th className="p-4 font-semibold text-sm w-32">T4</th>
                        <th className="p-4 font-semibold text-sm w-32">T5</th>
                        <th className="p-4 font-semibold text-sm w-32">Beta</th>
                        <th className="p-4 font-semibold text-sm w-32">Pilot Run</th>
                        <th className="p-4 font-semibold text-sm w-32">MP</th>
                        <th className="p-4 font-semibold text-sm w-32">XF</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((task) => (
                        <tr key={task.id} className="border-t border-[#E1E3E1] hover:bg-gray-50 transition-colors group">
                          <td className="p-4 text-sm font-medium sticky left-0 bg-white group-hover:bg-gray-50 z-10 border-r border-[#E1E3E1]">
                            <div className="flex flex-col gap-1">
                              <input 
                                value={task.project} 
                                onChange={(e) => handleTableEdit(task.id, 'project', e.target.value)}
                                className="bg-transparent border-none outline-none w-full font-bold text-blue-700"
                              />
                              <textarea 
                                value={task.projectDescription} 
                                onChange={(e) => handleTableEdit(task.id, 'projectDescription', e.target.value)}
                                className="bg-transparent border-none outline-none w-full text-[10px] text-gray-500 resize-none h-8"
                              />
                            </div>
                          </td>
                          <td className="p-4 text-sm">
                            <input 
                              value={task.partNo} 
                              onChange={(e) => handleTableEdit(task.id, 'partNo', e.target.value)}
                              className="bg-transparent border-none outline-none w-full"
                            />
                          </td>
                          <td className="p-4 text-sm">
                            <input 
                              value={task.molder} 
                              onChange={(e) => handleTableEdit(task.id, 'molder', e.target.value)}
                              className="bg-transparent border-none outline-none w-full"
                            />
                          </td>
                          <td className="p-4 text-sm">
                            <input 
                              value={task.odm} 
                              onChange={(e) => handleTableEdit(task.id, 'odm', e.target.value)}
                              className="bg-transparent border-none outline-none w-full"
                            />
                          </td>
                          <td className="p-4 text-sm">
                            <input 
                              value={task.currentStage} 
                              onChange={(e) => handleTableEdit(task.id, 'currentStage', e.target.value)}
                              className="bg-transparent border-none outline-none w-full font-bold"
                            />
                          </td>
                          <td className={`p-4 text-sm font-medium ${isStatusUpdated(task) ? 'text-blue-600' : 'text-[#44474E]'}`}>
                            <textarea 
                              value={task.latestStatus} 
                              onChange={(e) => handleTableEdit(task.id, 'latestStatus', e.target.value)}
                              className="bg-transparent border-none outline-none w-full whitespace-normal break-words min-h-[60px] resize-y"
                            />
                          </td>
                          {['toolingStart', 't1', 't2', 't3', 't4', 't5'].map(t => (
                            <td key={t} className="p-4 text-xs">
                              <input 
                                type="date"
                                value={(task.timelinePoints as any)[t] || ''} 
                                onChange={(e) => handleTableEdit(task.id, `timelinePoints.${t}`, e.target.value)}
                                className="bg-transparent border-none outline-none w-full"
                              />
                            </td>
                          ))}
                          {['beta', 'pilotRun', 'mp', 'xf'].map(m => (
                            <td key={m} className="p-4 text-xs">
                              <input 
                                type="date"
                                value={(task.milestones as any)[m] || ''} 
                                onChange={(e) => handleTableEdit(task.id, `milestones.${m}`, e.target.value)}
                                className="bg-transparent border-none outline-none w-full"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeTab === 'issues' && (
              <motion.div 
                key="issues"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="bg-white rounded-3xl border border-[#E1E3E1] shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-[#E1E3E1] flex justify-between items-center">
                    <h3 className="text-lg font-bold">Issue List (Extracted from Status)</h3>
                    <div className="text-xs text-gray-400">
                      Scanning for: delay, issue, problem, fail, ng
                    </div>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 gap-4">
                      {filteredTasks.flatMap(task => {
                        const status = (task.latestStatus || '').toLowerCase();
                        const keywords = ['delay', 'issue', 'problem', 'fail', 'ng'];
                        
                        // Split status by lines or bullets to find individual issues
                        const lines = (task.latestStatus || '').split(/\n|;|\./).filter(l => l.trim().length > 5);
                        
                        return lines.filter(line => 
                          keywords.some(k => line.toLowerCase().includes(k))
                        ).map((issueLine, idx) => ({
                          task,
                          issueLine,
                          id: `${task.id}-${idx}`
                        }));
                      }).map(({ task, issueLine, id }) => (
                        <div key={id} className="p-6 bg-white rounded-3xl border border-[#E1E3E1] flex flex-col md:flex-row gap-6 items-start hover:shadow-md transition-shadow">
                          <div className="md:w-72 shrink-0">
                            <div className="flex flex-wrap gap-2 mb-2">
                              <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-bold uppercase border border-blue-100">
                                {task.project}
                              </span>
                              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded-lg text-[10px] font-bold uppercase">
                                {task.partNo}
                              </span>
                              <span className="px-2 py-1 bg-amber-50 text-amber-700 rounded-lg text-[10px] font-bold uppercase">
                                {task.currentStage}
                              </span>
                            </div>
                            <h4 className="font-bold text-sm text-[#1A1C1E] line-clamp-2">{task.projectDescription}</h4>
                            <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
                              <Clock className="w-3 h-3" />
                              Updated: {format(new Date(), 'MMM dd, yyyy')}
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                              <span className="text-xs font-bold text-red-600 uppercase tracking-wider">Detected Issue</span>
                            </div>
                            <div className="text-sm text-[#44474E] leading-relaxed bg-gray-50 p-4 rounded-2xl border border-[#F0F0F0] italic">
                              "{issueLine.trim()}"
                            </div>
                          </div>
                          <div className="md:w-32 shrink-0 flex flex-col gap-2 self-center">
                            <button className="w-full py-2.5 bg-white border border-[#E1E3E1] rounded-xl text-xs font-bold hover:bg-gray-50 transition-colors shadow-sm">
                              Assign
                            </button>
                            <button className="w-full py-2.5 bg-[#0061A4] text-white rounded-xl text-xs font-bold hover:bg-[#004A7D] transition-colors shadow-lg shadow-blue-100">
                              Resolve
                            </button>
                          </div>
                        </div>
                      ))}
                      
                      {filteredTasks.every(t => {
                        const status = (t.latestStatus || '').toLowerCase();
                        return !(status.includes('delay') || status.includes('issue') || status.includes('problem') || status.includes('fail') || status.includes('ng'));
                      }) && (
                        <div className="col-span-full text-center py-20 text-gray-400 flex flex-col items-center gap-4">
                          <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center">
                            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                          </div>
                          <h4 className="text-lg font-bold text-[#1A1C1E]">All Clear!</h4>
                          <p>No critical issues detected in status updates.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Settings</h3>
                <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600">
                  <RefreshCw className="w-6 h-6 rotate-45" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Google Sheet URL</label>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={googleSheetUrl}
                      onChange={(e) => {
                        setGoogleSheetUrl(e.target.value);
                        localStorage.setItem('google_sheet_url', e.target.value);
                      }}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="flex-1 bg-gray-50 border-none rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    {googleSheetUrl && (
                      <a 
                        href={googleSheetUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="p-3 bg-gray-50 hover:bg-gray-100 rounded-xl text-blue-600 transition-colors"
                        title="Open Google Sheet"
                      >
                        <Share2 className="w-5 h-5" />
                      </a>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Google Apps Script URL</label>
                  <input 
                    type="text"
                    value={googleScriptUrl}
                    onChange={(e) => {
                      setGoogleScriptUrl(e.target.value);
                      localStorage.setItem('google_script_url', e.target.value);
                    }}
                    placeholder="https://script.google.com/macros/s/..."
                    className="w-full bg-gray-50 border-none rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <button 
                onClick={() => setShowSettings(false)}
                className="w-full mt-8 bg-[#0061A4] text-white py-3 rounded-xl font-bold shadow-lg shadow-blue-100"
              >
                Save & Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Task Modal */}
      <AnimatePresence>
        {editingTask && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Edit Timeline Points</h3>
                <button onClick={() => setEditingTask(null)} className="text-gray-400 hover:text-gray-600">
                  <RefreshCw className="w-6 h-6 rotate-45" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {Object.keys(editingTask.milestones).map(m => (
                  <div key={m}>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{m}</label>
                    <input 
                      type="date"
                      value={(editingTask.milestones as any)[m] || ''}
                      onChange={(e) => {
                        const next = { ...editingTask, milestones: { ...editingTask.milestones, [m]: e.target.value } };
                        setEditingTask(next);
                        setTasks(prev => prev.map(t => t.id === editingTask.id ? next : t));
                      }}
                      className="w-full bg-gray-50 border-none rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}
                {Object.keys(editingTask.timelinePoints).map(p => (
                  <div key={p}>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{p}</label>
                    <input 
                      type="date"
                      value={(editingTask.timelinePoints as any)[p] || ''}
                      onChange={(e) => {
                        const next = { ...editingTask, timelinePoints: { ...editingTask.timelinePoints, [p]: e.target.value } };
                        setEditingTask(next);
                        setTasks(prev => prev.map(t => t.id === editingTask.id ? next : t));
                      }}
                      className="w-full bg-gray-50 border-none rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ))}
              </div>
              <button 
                onClick={() => setEditingTask(null)}
                className="w-full mt-6 bg-[#0061A4] text-white py-3 rounded-xl font-bold"
              >
                Done
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-medium ${
        active ? 'bg-[#D3E4FF] text-[#001C38]' : 'text-[#44474E] hover:bg-gray-100'
      }`}
    >
      {React.cloneElement(icon as React.ReactElement<any>, { className: 'w-5 h-5' })}
      {label}
    </button>
  );
}

function StatCard({ label, value, icon }: { label: string, value: number | string, icon: React.ReactNode }) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-[#E1E3E1] shadow-sm flex items-center gap-4">
      <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center">
        {icon}
      </div>
      <div>
        <p className="text-xs font-semibold text-[#44474E] uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-[#1A1C1E]">{value}</p>
      </div>
    </div>
  );
}

function GanttChart({ tasks, onEdit, onUpdateTask }: { tasks: NPITask[], onEdit: (task: NPITask) => void, onUpdateTask: (task: NPITask) => void }) {
  if (tasks.length === 0) return null;

  const validTasks = tasks.filter(t => {
    const s = parseISO(t.startDate);
    const e = parseISO(t.endDate);
    return isValid(s) && isValid(e);
  });

  if (validTasks.length === 0) return (
    <div className="p-8 text-center text-gray-500 italic">
      No valid dates found.
    </div>
  );

  const startDates = validTasks.map(t => parseISO(t.startDate));
  const endDates = validTasks.map(t => parseISO(t.endDate));
  const minDate = startOfMonth(new Date(Math.min(...startDates.map(d => d.getTime()))));
  const maxDate = endOfMonth(new Date(Math.max(...endDates.map(d => d.getTime()))));
  
  if (!isValid(minDate) || !isValid(maxDate)) return null;

  const days = eachDayOfInterval({ start: minDate, end: maxDate });
  const dayWidth = 40;
  const today = new Date();

  const handleDragEnd = (task: NPITask, type: 'milestone' | 'point', key: string, info: any) => {
    const daysMoved = Math.round(info.offset.x / dayWidth);
    if (daysMoved === 0) return;

    const currentData = type === 'milestone' ? task.milestones : task.timelinePoints;
    const currentDateStr = (currentData as any)[key];
    if (!currentDateStr) return;

    const currentDate = parseISO(currentDateStr);
    if (!isValid(currentDate)) return;

    const newDate = addDays(currentDate, daysMoved);
    const newDateStr = format(newDate, 'yyyy-MM-dd');

    const updatedTask = {
      ...task,
      [type === 'milestone' ? 'milestones' : 'timelinePoints']: {
        ...currentData,
        [key]: newDateStr
      }
    };
    onUpdateTask(updatedTask);
  };

  return (
    <div className="relative border border-[#E1E3E1] rounded-xl overflow-hidden bg-white">
      <div className="overflow-auto max-h-[75vh]" style={{ scrollBehavior: 'smooth' }}>
        <div className="min-w-max relative">
          {/* Today Marker Line */}
          {isWithinInterval(today, { start: minDate, end: maxDate }) && (
            <div 
              className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-10 pointer-events-none"
              style={{ left: 256 + (differenceInDays(today, minDate) || 0) * dayWidth }}
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full"></div>
            </div>
          )}

          {/* Sticky Header */}
          <div className="flex sticky top-0 z-50 bg-[#F8F9FA] border-b border-[#E1E3E1]">
            <div className="w-64 sticky left-0 bg-[#F8F9FA] z-[60] p-4 font-bold text-xs border-r border-[#E1E3E1] flex items-center">
              Project / Part Number
            </div>
            <div className="flex">
              {days.map((day, i) => (
                <div 
                  key={i} 
                  id={format(day, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd') ? 'today-marker' : undefined}
                  className={`flex flex-col items-center justify-center text-[10px] border-l border-[#F0F0F0] py-2 ${
                    format(day, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd') ? 'bg-red-50 font-bold text-red-600' : 'text-[#44474E]'
                  }`} 
                  style={{ width: dayWidth }}
                >
                  <span className="opacity-40 text-[8px] uppercase">{format(day, 'EEE')}</span>
                  <span className="text-sm">{format(day, 'd')}</span>
                  <span className="opacity-50 text-[9px]">{format(day, 'MMM')}</span>
                </div>
              ))}
            </div>
          </div>
          
          <div className="divide-y divide-[#F0F0F0]">
            {validTasks.map((task) => {
              return (
                <div key={task.id} className="flex items-center group hover:bg-gray-50/50 transition-colors">
                  <div 
                    className="w-64 sticky left-0 bg-white z-40 p-4 text-xs font-medium border-r border-[#E1E3E1] group-hover:bg-gray-50 cursor-pointer shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]"
                    onClick={() => onEdit(task)}
                  >
                    <div className="font-bold text-[#0061A4] mb-1">{task.project}</div>
                    <div className="text-[11px] text-[#44474E] line-clamp-2 leading-tight mb-1">{task.projectDescription}</div>
                    <div className="text-[10px] text-gray-400 font-mono">{task.partNo}</div>
                  </div>
                  <div className="relative h-20 flex-1">
                {/* Milestones (Red Dots) */}
                {Object.entries(task.milestones || {}).map(([key, date]) => {
                  if (!date) return null;
                  const d = parseISO(date);
                  if (!isValid(d)) return null;
                  const offset = (differenceInDays(d, minDate) || 0) * dayWidth;
                  if (isNaN(offset)) return null;
                  return (
                    <motion.div 
                      key={key}
                      drag="x"
                      dragConstraints={{ left: -offset, right: (days.length * dayWidth) - offset }}
                      dragElastic={0}
                      dragMomentum={false}
                      onDragEnd={(_, info) => handleDragEnd(task, 'milestone', key, info)}
                      className="absolute top-2 w-3 h-3 bg-red-600 rounded-full transform -translate-x-1/2 z-10 shadow-sm cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
                      style={{ left: offset }}
                      onClick={(e) => { e.stopPropagation(); onEdit(task); }}
                      title={`${key.toUpperCase()}: ${date} (Drag to move)`}
                    >
                      <span className="absolute -top-4 left-1/2 transform -translate-x-1/2 text-[8px] font-bold text-red-700 whitespace-nowrap bg-white/80 px-1 rounded">
                        {key.toUpperCase()}
                      </span>
                    </motion.div>
                  );
                })}

                {/* Events (Blue Dots) */}
                {Object.entries(task.timelinePoints || {}).map(([key, date]) => {
                  if (!date) return null;
                  const d = parseISO(date);
                  if (!isValid(d)) return null;
                  const offset = (differenceInDays(d, minDate) || 0) * dayWidth;
                  if (isNaN(offset)) return null;
                  return (
                    <motion.div 
                      key={key}
                      drag="x"
                      dragConstraints={{ left: -offset, right: (days.length * dayWidth) - offset }}
                      dragElastic={0}
                      dragMomentum={false}
                      onDragEnd={(_, info) => handleDragEnd(task, 'point', key, info)}
                      className="absolute top-8 w-2 h-2 bg-blue-600 rounded-full transform -translate-x-1/2 z-10 cursor-grab active:cursor-grabbing hover:scale-125 transition-transform"
                      style={{ left: offset }}
                      onClick={(e) => { e.stopPropagation(); onEdit(task); }}
                      title={`${key.toUpperCase()}: ${date} (Drag to move)`}
                    >
                      <span className="absolute top-3 left-1/2 transform -translate-x-1/2 text-[8px] font-bold text-blue-700 whitespace-nowrap bg-white/80 px-1 rounded">
                        {key.toUpperCase()}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </div>
</div>
  );
}

function ProjectMiniTimeline({ task }: { task: NPITask }) {
  const allDateStrings = [
    task.startDate, 
    task.endDate, 
    ...Object.values(task.milestones || {}), 
    ...Object.values(task.timelinePoints || {})
  ].filter(Boolean);

  const validDates = allDateStrings
    .map(d => parseISO(d!))
    .filter(d => isValid(d));

  if (validDates.length === 0) return (
    <div className="h-16 bg-gray-50 rounded-xl flex items-center justify-center text-[10px] text-gray-400 italic border border-[#F0F0F0]">
      No valid dates
    </div>
  );
  
  const minDate = startOfMonth(new Date(Math.min(...validDates.map(d => d.getTime()))));
  const maxDate = endOfMonth(new Date(Math.max(...validDates.map(d => d.getTime()))));
  
  if (!isValid(minDate) || !isValid(maxDate)) return null;

  const totalDays = Math.max(differenceInDays(maxDate, minDate), 1);
  const today = new Date();

  return (
    <div className="relative h-16 bg-gray-50 rounded-xl p-2 overflow-hidden border border-[#F0F0F0]">
      {/* Today Marker */}
      {isWithinInterval(today, { start: minDate, end: maxDate }) && !isNaN(differenceInDays(today, minDate)) && (
        <div 
          className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-20 animate-pulse"
          style={{ left: `${Math.max(0, Math.min(100, (differenceInDays(today, minDate) / totalDays) * 100))}%` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full"></div>
        </div>
      )}

      {/* Milestones */}
      {Object.entries(task.milestones || {}).map(([key, date]) => {
        if (!date) return null;
        const d = parseISO(date);
        if (!isValid(d)) return null;
        const pos = (differenceInDays(d, minDate) / totalDays) * 100;
        if (isNaN(pos)) return null;
        return (
          <div key={key} className="absolute top-2 flex flex-col items-center" style={{ left: `${pos}%` }}>
            <div className="w-2 h-2 bg-red-600 rounded-full"></div>
            <span className="text-[8px] font-bold text-red-700 mt-1">{key.toUpperCase()}</span>
          </div>
        );
      })}

      {/* Events */}
      {Object.entries(task.timelinePoints || {}).map(([key, date]) => {
        if (!date) return null;
        const d = parseISO(date);
        if (!isValid(d)) return null;
        const pos = (differenceInDays(d, minDate) / totalDays) * 100;
        if (isNaN(pos)) return null;
        return (
          <div key={key} className="absolute top-8 flex flex-col items-center" style={{ left: `${pos}%` }}>
            <div className="w-1.5 h-1.5 bg-blue-600 rounded-full"></div>
            <span className="text-[8px] font-bold text-blue-700 mt-1">{key.toUpperCase()}</span>
          </div>
        );
      })}
    </div>
  );
}
