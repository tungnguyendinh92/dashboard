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
import { format, parseISO, differenceInDays, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval, isValid, isAfter } from 'date-fns';
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
  const [activeTimelinePoint, setActiveTimelinePoint] = useState<{ task: NPITask, key: string, date: string } | null>(null);
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
        
        // Read all sheets and concatenate data
        let allRawRows: any[] = [];
        wb.SheetNames.forEach(sheetName => {
          const ws = wb.Sheets[sheetName];
          const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1 });
          if (sheetRows.length > 0) {
            // Add sheet name as a virtual column if needed, but for now just concat
            allRawRows = [...allRawRows, ...sheetRows];
          }
        });
        
        if (allRawRows.length === 0) {
          alert("The Excel file seems to be empty.");
          return;
        }

        const parsedTasksRaw = await parseExcelDataWithAI(allRawRows);
        
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
        timelinePoints: { toolingStart: format(new Date(), 'yyyy-MM-dd'), t1: format(addDays(new Date(), 15), 'yyyy-MM-dd') },
        issues: [
          { trial: 'T1', description: 'Surface scratch', status: 'open', severity: 'medium', category: 'Cosmetic' },
          { trial: 'T1', description: 'Dimension out of spec', status: 'open', severity: 'high', category: 'Function' }
        ]
      },
      {
        id: 'sample-2',
        project: 'Project Beta',
        projectDescription: 'Front Cover Tooling',
        partNo: 'FC-002',
        molder: 'Molder B',
        odm: 'ODM Y',
        currentStage: 'T0',
        latestStatus: 'Delay in tooling start',
        startDate: format(new Date(), 'yyyy-MM-dd'),
        endDate: format(addDays(new Date(), 120), 'yyyy-MM-dd'),
        milestones: { beta: format(addDays(new Date(), 45), 'yyyy-MM-dd') },
        timelinePoints: { toolingStart: format(addDays(new Date(), 5), 'yyyy-MM-dd') },
        issues: [
          { trial: 'T0', description: 'ECN change for latch', status: 'open', severity: 'high', category: 'ECN' }
        ]
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
    
    const aiResponse = await askAIAboutSchedule(tasks, projectNotes, userMsg);
    
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

  const deleteIssue = (taskId: string, issueLine: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const lines = (t.latestStatus || '').split(/\n|;|\./);
        const filteredLines = lines.filter(l => l.trim() !== issueLine.trim());
        return { ...t, latestStatus: filteredLines.join('. ') };
      }
      return t;
    }));
  };

  const toggleIssueCategory = (taskId: string, issueLine: string) => {
    setTasks(prev => prev.map(task => {
      if (task.id !== taskId) return task;
      
      const categories: ('Function' | 'Cosmetic' | 'ECN' | 'Other')[] = ['Function', 'Cosmetic', 'ECN', 'Other'];
      const issues = [...(task.issues || [])];
      const matchedIdx = issues.findIndex(i => 
        issueLine.toLowerCase().includes(i.description.toLowerCase()) || 
        i.description.toLowerCase().includes(issueLine.toLowerCase())
      );

      if (matchedIdx > -1) {
        const currentCat = issues[matchedIdx].category;
        const nextCat = categories[(categories.indexOf(currentCat) + 1) % categories.length];
        issues[matchedIdx] = { ...issues[matchedIdx], category: nextCat };
      } else {
        issues.push({
          trial: 'Latest',
          description: issueLine,
          status: 'open',
          severity: 'medium',
          category: 'Function'
        });
      }
      
      return { ...task, issues };
    }));
  };

  const stats = {
    totalProjects: Object.keys(groupedTasks).length,
    totalParts: filteredTasks.length,
    activeStages: new Set(filteredTasks.map(t => t.currentStage)).size,
    alerts: filteredTasks.filter(t => (t.latestStatus || '').toLowerCase().includes('delay')).length,
  };

  const getPendingIssuesCount = (projectTasks: NPITask[]) => {
    return projectTasks.reduce((count, task) => {
      const explicitIssues = (task.issues || []).filter(i => i.status === 'open').length;
      const statusText = (task.latestStatus || '').toLowerCase();
      const keywords = ['delay', 'issue', 'problem', 'fail', 'ng'];
      const lines = statusText.split(/\n|;|\./).filter(l => l.trim().length > 5);
      const textIssues = lines.filter(line => keywords.some(k => line.toLowerCase().includes(k))).length;
      return count + Math.max(explicitIssues, textIssues);
    }, 0);
  };

  const stageData = Object.entries(
    filteredTasks.reduce((acc, t) => {
      const stage = t.currentStage || 'N/A';
      acc[stage] = (acc[stage] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).map(([name, value]) => ({ name, value }));

  const projectHealthData = Object.entries(groupedTasks).map(([projectName, projectTasks]) => {
    const issues = projectTasks.flatMap(t => t.issues || []);
    const categories = {
      Function: issues.filter(i => i.category === 'Function' && i.status === 'open').length,
      Cosmetic: issues.filter(i => i.category === 'Cosmetic' && i.status === 'open').length,
      ECN: issues.filter(i => i.category === 'ECN' && i.status === 'open').length,
      Other: issues.filter(i => i.category === 'Other' && i.status === 'open').length,
    };
    return {
      name: projectName,
      ...categories,
      total: Object.values(categories).reduce((a, b) => a + b, 0)
    };
  }).filter(d => d.total > 0);

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

      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-64 bg-white border-r border-[#E1E3E1] p-6 flex-col gap-8 z-20">
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

      {/* Mobile Navigation */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#E1E3E1] px-4 py-2 flex justify-around items-center z-[60] shadow-[0_-4px_10px_rgba(0,0,0,0.05)]">
        <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'dashboard' ? 'text-blue-600' : 'text-gray-400'}`}>
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[10px] font-medium">Dashboard</span>
        </button>
        <button onClick={() => setActiveTab('timeline')} className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'timeline' ? 'text-blue-600' : 'text-gray-400'}`}>
          <Calendar className="w-5 h-5" />
          <span className="text-[10px] font-medium">Timeline</span>
        </button>
        <button onClick={() => setActiveTab('table')} className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'table' ? 'text-blue-600' : 'text-gray-400'}`}>
          <FileSpreadsheet className="w-5 h-5" />
          <span className="text-[10px] font-medium">Table</span>
        </button>
        <button onClick={() => setActiveTab('issues')} className={`flex flex-col items-center gap-1 p-2 ${activeTab === 'issues' ? 'text-blue-600' : 'text-gray-400'}`}>
          <AlertCircle className="w-5 h-5" />
          <span className="text-[10px] font-medium">Issues</span>
        </button>
        <button onClick={() => setShowAISidebar(!showAISidebar)} className={`flex flex-col items-center gap-1 p-2 ${showAISidebar ? 'text-blue-600' : 'text-gray-400'}`}>
          <MessageSquare className="w-5 h-5" />
          <span className="text-[10px] font-medium">AI</span>
        </button>
      </nav>

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
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            className="fixed right-0 top-0 h-full w-full sm:w-80 bg-white border-l border-[#E1E3E1] flex flex-col z-[70] lg:z-20 shadow-2xl"
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
      <main className={`transition-all duration-300 ${showAISidebar ? 'lg:mr-80' : 'mr-0'} lg:ml-64 p-4 lg:p-8 min-h-screen pb-24 lg:pb-8`}>
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
                  <div className="bg-white p-6 rounded-3xl border border-[#E1E3E1] shadow-sm flex flex-col">
                    <h3 className="text-lg font-bold mb-4">Project Health (Open Issues)</h3>
                    <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={projectHealthData} layout="vertical" margin={{ left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                          <XAxis type="number" axisLine={false} tickLine={false} />
                          <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={80} />
                          <Tooltip cursor={{fill: '#f3f4f6'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                          <Legend />
                          <Bar dataKey="Function" stackId="a" fill="#ef4444" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="Cosmetic" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="ECN" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="Other" stackId="a" fill="#6b7280" radius={[0, 4, 4, 0]} />
                        </BarChart>
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
                      {Object.entries(groupedTasks).map(([projectName, projectTasks]) => {
                        const pendingIssues = getPendingIssuesCount(projectTasks);
                        const nextMilestone = getNextMilestone(projectTasks);
                        
                        return (
                          <div key={projectName} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pb-8 border-b border-[#F0F0F0] last:border-0">
                            <div className="lg:col-span-3">
                              <h4 className="font-bold text-[#1A1C1E] text-lg">{projectName}</h4>
                              <p className="text-xs text-gray-500 mb-3">{projectTasks.length} parts</p>
                              
                              <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <div className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase border ${pendingIssues > 0 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                                    {pendingIssues} Pending Issues
                                  </div>
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-1 mt-4">
                                {Array.from(new Set(projectTasks.map(t => t.currentStage))).map(stage => (
                                  <span key={stage} className="px-2 py-1 bg-gray-50 text-gray-600 rounded-lg text-[9px] font-bold uppercase">
                                    {stage}
                                  </span>
                                ))}
                              </div>
                            </div>
                            
                            <div className="lg:col-span-12 mt-4">
                              <ProjectPipeStack projectTasks={projectTasks} />
                              <div className="mt-4 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Project Notes</label>
                                <textarea 
                                  placeholder="Add project notes, risks, or updates..."
                                  value={projectNotes[projectName] || ''}
                                  onChange={(e) => handleNoteChange(projectName, e.target.value)}
                                  className="w-full min-h-[80px] bg-transparent border-none p-0 text-sm focus:ring-0 outline-none resize-none"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
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
                  <GanttChart 
                    tasks={filteredTasks} 
                    onEdit={setEditingTask} 
                    onUpdateTask={(updatedTask) => {
                      setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t));
                    }} 
                    onPointClick={(task, key, date) => setActiveTimelinePoint({ task, key, date })}
                  />
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
                        <th className="p-4 font-semibold text-sm w-32">DFM</th>
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
                                value={task.project || ''} 
                                onChange={(e) => handleTableEdit(task.id, 'project', e.target.value)}
                                className="bg-transparent border-none outline-none w-full font-bold text-blue-700"
                              />
                              <textarea 
                                value={task.projectDescription || ''} 
                                onChange={(e) => handleTableEdit(task.id, 'projectDescription', e.target.value)}
                                className="bg-transparent border-none outline-none w-full text-[10px] text-gray-500 resize-none h-8"
                              />
                            </div>
                          </td>
                          <td className="p-4 text-sm">
                            <input 
                              value={task.partNo || ''} 
                              onChange={(e) => handleTableEdit(task.id, 'partNo', e.target.value)}
                              className="bg-transparent border-none outline-none w-full"
                            />
                          </td>
                          <td className="p-4 text-sm">
                            <input 
                              value={task.molder || ''} 
                              onChange={(e) => handleTableEdit(task.id, 'molder', e.target.value)}
                              className="bg-transparent border-none outline-none w-full"
                            />
                          </td>
                          <td className="p-4 text-sm">
                            <input 
                              value={task.odm || ''} 
                              onChange={(e) => handleTableEdit(task.id, 'odm', e.target.value)}
                              className="bg-transparent border-none outline-none w-full"
                            />
                          </td>
                          <td className="p-4 text-sm">
                            <input 
                              value={task.currentStage || ''} 
                              onChange={(e) => handleTableEdit(task.id, 'currentStage', e.target.value)}
                              className="bg-transparent border-none outline-none w-full font-bold"
                            />
                          </td>
                          <td className={`p-4 text-sm font-medium ${isStatusUpdated(task) ? 'text-blue-600' : 'text-[#44474E]'}`}>
                            <textarea 
                              value={task.latestStatus || ''} 
                              onChange={(e) => handleTableEdit(task.id, 'latestStatus', e.target.value)}
                              className="bg-transparent border-none outline-none w-full whitespace-normal break-words min-h-[60px] resize-y"
                            />
                          </td>
                          {['dfm', 'toolingStart', 't1', 't2', 't3', 't4', 't5'].map(t => (
                            <td key={t} className="p-4 text-xs">
                              <input 
                                type="date"
                                value={(task.timelinePoints || {} as any)[t] || ''} 
                                onChange={(e) => handleTableEdit(task.id, `timelinePoints.${t}`, e.target.value)}
                                className="bg-transparent border-none outline-none w-full"
                              />
                            </td>
                          ))}
                          {['beta', 'pilotRun', 'mp', 'xf'].map(m => (
                            <td key={m} className="p-4 text-xs">
                              <input 
                                type="date"
                                value={(task.milestones || {} as any)[m] || ''} 
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
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                                <span className="text-xs font-bold text-red-600 uppercase tracking-wider">Detected Issue</span>
                              </div>
                              {(() => {
                                const matchedIssue = task.issues?.find(i => 
                                  issueLine.toLowerCase().includes(i.description.toLowerCase()) || 
                                  i.description.toLowerCase().includes(issueLine.toLowerCase())
                                );
                                return (
                                  <button 
                                    onClick={() => toggleIssueCategory(task.id, issueLine)}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase border transition-all hover:scale-105 active:scale-95 ${
                                      matchedIssue?.category 
                                        ? 'bg-purple-50 text-purple-700 border-purple-100' 
                                        : 'bg-gray-50 text-gray-500 border-gray-200'
                                    }`}
                                  >
                                    {matchedIssue?.category || 'Uncategorized'}
                                  </button>
                                );
                              })()}
                            </div>
                            <div className="text-sm text-[#44474E] leading-relaxed bg-gray-50 p-4 rounded-2xl border border-[#F0F0F0] italic">
                              "{issueLine.trim()}"
                            </div>
                          </div>
                          <div className="md:w-32 shrink-0 flex flex-col gap-2 self-center">
                            <button 
                              onClick={() => deleteIssue(task.id, issueLine)}
                              className="w-full py-2.5 bg-red-50 text-red-600 border border-red-100 rounded-xl text-xs font-bold hover:bg-red-100 transition-colors shadow-sm"
                            >
                              Delete
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
                {['dfm', 'toolingStart', 't1', 't2', 't3', 't4', 't5'].map(p => (
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

      {/* Timeline Point Status Popup */}
      <AnimatePresence>
        {activeTimelinePoint && (
          <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setActiveTimelinePoint(null)}>
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl border border-blue-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-start mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-bold uppercase border border-blue-100">
                      {activeTimelinePoint.key.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-400 font-medium">
                      {format(parseISO(activeTimelinePoint.date), 'MMM dd, yyyy')}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-[#1A1C1E]">{activeTimelinePoint.task.projectDescription}</h3>
                  <p className="text-xs text-gray-500 font-mono mt-1">{activeTimelinePoint.task.partNo}</p>
                </div>
                <button 
                  onClick={() => setActiveTimelinePoint(null)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <RefreshCw className="w-5 h-5 text-gray-400 rotate-45" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100">
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-bold text-blue-700 uppercase tracking-wider">Latest Status</span>
                  </div>
                  <div className="text-sm text-[#44474E] leading-relaxed whitespace-pre-wrap">
                    {activeTimelinePoint.task.latestStatus || 'No status updates available for this part.'}
                  </div>
                </div>

                {activeTimelinePoint.task.issues && activeTimelinePoint.task.issues.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <AlertCircle className="w-4 h-4 text-red-500" />
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Related Issues</span>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                      {activeTimelinePoint.task.issues.map((issue, idx) => (
                        <div key={idx} className="p-3 bg-white border border-[#F0F0F0] rounded-xl flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-[#44474E] truncate">{issue.description}</p>
                          </div>
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase ${
                            issue.category === 'Function' ? 'bg-red-50 text-red-600' :
                            issue.category === 'Cosmetic' ? 'bg-amber-50 text-amber-600' :
                            issue.category === 'ECN' ? 'bg-purple-50 text-purple-600' :
                            'bg-gray-50 text-gray-600'
                          }`}>
                            {issue.category}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-8 flex gap-3">
                <button 
                  onClick={() => {
                    setEditingTask(activeTimelinePoint.task);
                    setActiveTimelinePoint(null);
                  }}
                  className="flex-1 py-3 bg-[#0061A4] text-white rounded-xl font-bold text-sm hover:bg-[#004A7D] transition-all shadow-lg shadow-blue-100"
                >
                  Edit Part Details
                </button>
                <button 
                  onClick={() => setActiveTimelinePoint(null)}
                  className="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all"
                >
                  Close
                </button>
              </div>
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

function GanttChart({ tasks, onEdit, onUpdateTask, onPointClick }: { tasks: NPITask[], onEdit: (task: NPITask) => void, onUpdateTask: (task: NPITask) => void, onPointClick: (task: NPITask, key: string, date: string) => void }) {
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  
  if (tasks.length === 0) return null;

  const toggleProject = (projectName: string) => {
    setExpandedProjects(prev => 
      prev.includes(projectName) 
        ? prev.filter(p => p !== projectName) 
        : [...prev, projectName]
    );
  };

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

  const groupedValidTasks = validTasks.reduce((acc, task) => {
    if (!acc[task.project]) acc[task.project] = [];
    acc[task.project].push(task);
    return acc;
  }, {} as Record<string, NPITask[]>);

  const startDates = validTasks.map(t => parseISO(t.startDate));
  const endDates = [
    ...validTasks.map(t => parseISO(t.endDate)),
    ...validTasks.flatMap(t => Object.values(t.milestones || {}).map(d => parseISO(d!))),
    ...validTasks.flatMap(t => Object.values(t.timelinePoints || {}).map(d => parseISO(d!)))
  ].filter(d => isValid(d));

  const minDate = startOfMonth(new Date(Math.min(...startDates.map(d => d.getTime()))));
  const maxDate = endOfMonth(addDays(new Date(Math.max(...endDates.map(d => d.getTime()))), 90)); // + 3 months
  
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
          <div className="flex sticky top-0 z-50 bg-[#F8F9FA] border-b border-[#E1E3E1]" style={{ width: 256 + days.length * dayWidth }}>
            <div className="w-64 sticky left-0 bg-[#F8F9FA] z-[60] p-4 font-bold text-xs border-r border-[#E1E3E1] flex items-center">
              Project / Part Number
            </div>
            <div className="flex flex-none">
              {days.map((day, i) => (
                <div 
                  key={i} 
                  id={format(day, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd') ? 'today-marker' : undefined}
                  className={`flex flex-col items-center justify-center text-[10px] border-l border-[#F0F0F0] py-2 flex-none ${
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
            {Object.entries(groupedValidTasks).map(([projectName, projectTasks]) => {
              const isExpanded = expandedProjects.includes(projectName);
              // Use the first task's milestones as project milestones
              const projectTask = projectTasks[0];
              
              return (
                <React.Fragment key={projectName}>
                  {/* Project Milestone Row */}
                  <div className="flex items-center bg-blue-50/30 group hover:bg-blue-50/50 transition-colors relative" style={{ width: 256 + days.length * dayWidth }}>
                    <div 
                      className="w-64 sticky left-0 bg-blue-50 z-[45] p-4 text-xs font-medium border-r border-[#E1E3E1] cursor-pointer shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)] flex items-center justify-between"
                      onClick={() => toggleProject(projectName)}
                    >
                      <div className="flex flex-col gap-1">
                        <div className="font-bold text-[#0061A4] text-sm flex items-center gap-2">
                          {projectName}
                          {getNextMilestone(projectTasks) && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                              Next: {getNextMilestone(projectTasks)?.name.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-blue-600 font-bold uppercase mt-1 tracking-wider flex items-center gap-1">
                          <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          Project Milestones
                        </div>
                      </div>
                      <div className="text-[10px] bg-white px-2 py-1 rounded-lg border border-blue-100 text-blue-700 font-bold">
                        {projectTasks.length}
                      </div>
                    </div>
                    <div className="relative h-16 flex-none" style={{ width: days.length * dayWidth }}>
                      {/* Vertical Grid Lines */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {days.map((_, i) => (
                          <div 
                            key={i} 
                            className="border-l border-[#F0F0F0] h-full flex-none" 
                            style={{ width: dayWidth }}
                          />
                        ))}
                      </div>
                      
                      {/* Project Milestones (Red Dots) */}
                      {Object.entries(projectTask.milestones || {}).map(([key, date]) => {
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
                            whileDrag={{ scale: 1.3, zIndex: 50 }}
                            onDragEnd={(_, info) => handleDragEnd(projectTask, 'milestone', key, info)}
                            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-red-600 rounded-full transform -translate-x-1/2 z-10 shadow-lg cursor-grab active:cursor-grabbing hover:scale-125 transition-all duration-200"
                            style={{ left: offset }}
                            title={`${key.toUpperCase()}: ${date} (Project Milestone)`}
                          >
                            <span className="absolute -top-6 left-1/2 transform -translate-x-1/2 text-[9px] font-black text-red-700 whitespace-nowrap bg-white/90 px-1.5 py-0.5 rounded-full border border-red-100 shadow-sm">
                              {key.toUpperCase()}
                            </span>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-white rounded-full"></div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Sub-parts Rows */}
                  <AnimatePresence>
                    {isExpanded && projectTasks.map((task) => (
                      <div 
                        key={task.id}
                        className="flex items-center group hover:bg-gray-50/50 transition-colors" 
                        style={{ width: 256 + days.length * dayWidth }}
                      >
                        <div 
                          className="w-64 sticky left-0 bg-white z-[45] p-4 pl-8 text-xs font-medium border-r border-[#E1E3E1] group-hover:bg-gray-50 cursor-pointer shadow-[4px_0_8px_-4px_rgba(0,0,0,0.05)]"
                          onClick={() => onEdit(task)}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="text-[11px] text-[#1A1C1E] font-bold line-clamp-1 leading-tight">{task.projectDescription || 'No description'}</div>
                            {task.issues && task.issues.filter(i => i.status === 'open').length > 0 && (
                              <div className="flex flex-wrap gap-0.5 shrink-0 justify-end max-w-[80px]">
                                {Array.from(new Set(task.issues.filter(i => i.status === 'open').map(i => i.category))).map(cat => (
                                  <span key={cat} className="px-1 py-0.5 rounded-[4px] bg-red-50 text-red-600 text-[7px] font-black uppercase border border-red-100 leading-none" title={cat}>
                                    {cat.substring(0, 3)}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] text-gray-400 font-mono">{task.partNo || 'N/A'}</div>
                            <div className="text-[9px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 font-bold uppercase">{task.currentStage || 'N/A'}</div>
                          </div>
                        </div>
                        <div className="relative h-14 flex-none" style={{ width: days.length * dayWidth }}>
                          {/* Vertical Grid Lines */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {days.map((_, i) => (
                              <div 
                                key={i} 
                                className="border-l border-[#F0F0F0] h-full flex-none" 
                                style={{ width: dayWidth }}
                              />
                            ))}
                          </div>

                          {/* Task Duration Bar */}
                          {(() => {
                            const start = parseISO(task.startDate);
                            const end = parseISO(task.endDate);
                            if (isValid(start) && isValid(end)) {
                              const left = (differenceInDays(start, minDate) || 0) * dayWidth;
                              const width = (differenceInDays(end, start) + 1) * dayWidth;
                              // Use a consistent color based on part number hash
                              const colors = ['bg-blue-400', 'bg-emerald-400', 'bg-indigo-400', 'bg-purple-400', 'bg-cyan-400'];
                              const colorIndex = Math.abs(task.partNo.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % colors.length;
                              return (
                                <div 
                                  className={`absolute top-1/2 -translate-y-1/2 h-4 ${colors[colorIndex]} opacity-60 rounded-full z-0 shadow-sm`}
                                  style={{ left, width }}
                                />
                              );
                            }
                            return null;
                          })()}

                          {/* Timeline Points (Blue Dots) - Only Tooling Start, T1, T2... */}
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
                                whileDrag={{ scale: 1.3, zIndex: 50 }}
                                onDragEnd={(_, info) => handleDragEnd(task, 'point', key, info)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onPointClick(task, key, date);
                                }}
                                className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-blue-600 rounded-full transform -translate-x-1/2 z-10 cursor-pointer active:cursor-grabbing hover:scale-125 transition-all duration-200 shadow-sm"
                                style={{ left: offset }}
                                title={`${key.toUpperCase()}: ${date}`}
                              >
                                <span className="absolute top-4 left-1/2 transform -translate-x-1/2 text-[8px] font-bold text-blue-700 whitespace-nowrap bg-white/80 px-1 rounded">
                                  {key.toUpperCase()}
                                </span>
                              </motion.div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </AnimatePresence>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function getNextMilestone(projectTasks: NPITask[]) {
  const today = new Date();
  let nextDate: Date | null = null;
  let nextName = '';

  projectTasks.forEach(task => {
    Object.entries(task.milestones || {}).forEach(([name, dateStr]) => {
      if (dateStr) {
        const d = parseISO(dateStr);
        if (isValid(d) && isAfter(d, today)) {
          if (!nextDate || d < nextDate) {
            nextDate = d;
            nextName = name;
          }
        }
      }
    });
  });

  if (!nextDate) return null;
  const days = differenceInDays(nextDate, today);
  return { name: nextName, days, date: nextDate };
}

function ProjectPipeStack({ projectTasks }: { projectTasks: NPITask[] }) {
  const projectTask = projectTasks[0];
  const milestones = projectTask.milestones || {};
  const today = new Date();
  const nextMilestone = getNextMilestone(projectTasks);
  
  const stages = [
    { name: 'Beta', date: milestones.beta, color: 'bg-blue-500' },
    { name: 'Pilot Run', date: milestones.pilotRun, color: 'bg-emerald-500' },
    { name: 'MP', date: milestones.mp, color: 'bg-amber-500' },
    { name: 'XF', date: milestones.xf, color: 'bg-purple-500' },
  ].filter(s => s.date && isValid(parseISO(s.date)));

  if (stages.length === 0) return <div className="h-10 bg-gray-50 rounded-full flex items-center justify-center text-[10px] text-gray-400 italic">No milestones defined</div>;

  const sortedStages = [...stages].sort((a, b) => parseISO(a.date!).getTime() - parseISO(b.date!).getTime());
  
  // If only 1 milestone, we can't show a bar, so show a point or a simple bar
  if (sortedStages.length === 1) {
    return (
      <div className="flex items-center gap-4">
        <div className="flex-1 relative h-10 bg-gray-100 rounded-full overflow-hidden flex items-center px-4">
          <div className={`${sortedStages[0].color} px-3 py-1 rounded-full text-[10px] font-bold text-white`}>
            {sortedStages[0].name}: {format(parseISO(sortedStages[0].date!), 'MMM dd')}
          </div>
        </div>
        {nextMilestone && (
          <div className="shrink-0 text-right">
            <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Next Milestone</div>
            <div className="text-sm font-bold text-blue-700">{nextMilestone.name.toUpperCase()}</div>
            <div className="text-[10px] text-blue-500">{format(nextMilestone.date, 'MMM dd')} ({nextMilestone.days}d)</div>
          </div>
        )}
      </div>
    );
  }

  const minTime = parseISO(sortedStages[0].date!).getTime();
  const maxTime = parseISO(sortedStages[sortedStages.length - 1].date!).getTime();
  const totalDuration = Math.max(maxTime - minTime, 1);

  return (
    <div className="flex items-center gap-4">
      <div className="flex-1 relative h-10 bg-gray-100 rounded-full overflow-hidden flex">
        {sortedStages.map((stage, i) => {
          if (i === sortedStages.length - 1) return null;
          const nextStage = sortedStages[i + 1];
          const start = parseISO(stage.date!).getTime();
          const end = parseISO(nextStage.date!).getTime();
          const width = ((end - start) / totalDuration) * 100;
          
          return (
            <div 
              key={stage.name} 
              className={`${stage.color} h-full border-r border-white/20 flex items-center justify-center text-[10px] font-bold text-white overflow-hidden whitespace-nowrap`}
              style={{ width: `${width}%` }}
            >
              {stage.name}
            </div>
          );
        })}
        
        {/* Today Marker */}
        {today.getTime() >= minTime && today.getTime() <= maxTime && (
          <div 
            className="absolute top-0 bottom-0 w-1 bg-red-600 z-10"
            style={{ left: `${((today.getTime() - minTime) / totalDuration) * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-600 rounded-full border-2 border-white shadow-sm"></div>
          </div>
        )}
      </div>

      {nextMilestone && (
        <div className="shrink-0 text-right">
          <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Next Milestone</div>
          <div className="text-sm font-bold text-blue-700">{nextMilestone.name.toUpperCase()}</div>
          <div className="text-[10px] text-blue-500">{format(nextMilestone.date, 'MMM dd')} ({nextMilestone.days}d)</div>
        </div>
      )}
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
