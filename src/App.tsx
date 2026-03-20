import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  Upload, FileSpreadsheet, Calendar, LayoutDashboard, MessageSquare, 
  Settings, CheckCircle2, Clock, AlertCircle, ChevronRight, Send,
  RefreshCw, Share2, LogIn
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
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [projectNotes, setProjectNotes] = useState<Record<string, string>>({});
  const [editingTask, setEditingTask] = useState<NPITask | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Load from localStorage on mount
  useEffect(() => {
    const savedTasks = localStorage.getItem('npi_tasks');
    if (savedTasks) {
      const parsed = JSON.parse(savedTasks);
      setTasks(parsed);
      setPrevTasks(parsed);
    }
    
    const savedSheetUrl = localStorage.getItem('google_sheet_url');
    if (savedSheetUrl) setGoogleSheetUrl(savedSheetUrl);

    const savedNotes = localStorage.getItem('project_notes');
    if (savedNotes) setProjectNotes(JSON.parse(savedNotes));
  }, []);

  // Save to localStorage when data changes
  useEffect(() => {
    if (tasks.length > 0) localStorage.setItem('npi_tasks', JSON.stringify(tasks));
  }, [tasks]);

  useEffect(() => {
    localStorage.setItem('project_notes', JSON.stringify(projectNotes));
  }, [projectNotes]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, mode: 'replace' | 'update') => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);
      
      const parsedTasks = await parseExcelDataWithAI(data);
      
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
      setLoading(false);
    };
    reader.readAsBinaryString(file);
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
    
    if (aiResponse.updates) {
      setTasks(prev => {
        const next = [...prev];
        aiResponse.updates.forEach((update: any) => {
          const taskIndex = next.findIndex(t => t.id === update.id);
          if (taskIndex > -1) {
            const keys = update.field.split('.');
            let obj: any = next[taskIndex];
            for (let i = 0; i < keys.length - 1; i++) {
              if (!obj[keys[i]]) obj[keys[i]] = {};
              obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = update.value;
          }
        });
        return next;
      });
    }

    setChatHistory(prev => [...prev, { role: 'ai', content: aiResponse.answer }]);
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
    if (!googleSheetUrl) {
      alert("Please set Google Sheet URL in Settings first.");
      return;
    }
    // In a real app, this would call an API. For now, we simulate.
    alert("Data uploaded to Google Sheet successfully (Simulated).");
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
          <button 
            onClick={uploadToGoogleSheet}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-blue-700 bg-blue-50 hover:bg-blue-100 transition-all font-medium"
          >
            <Share2 className="w-5 h-5" />
            Upload to Sheet
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[#44474E] hover:bg-gray-100 transition-all font-medium"
          >
            <Settings className="w-5 h-5" />
            Settings
          </button>
        </div>
      </aside>

      {/* AI Sidebar */}
      <aside className="fixed right-0 top-0 h-full w-80 bg-white border-l border-[#E1E3E1] flex flex-col z-20">
        <div className="p-6 border-b border-[#E1E3E1] flex items-center gap-3">
          <MessageSquare className="w-5 h-5 text-blue-600" />
          <h3 className="font-bold">AI Assistant</h3>
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
      </aside>

      {/* Main Content */}
      <main className="ml-64 mr-80 p-8 min-h-screen">
        <header className="flex flex-col gap-6 mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-3xl font-bold text-[#1A1C1E]">NPI Schedule</h2>
              <p className="text-[#44474E]">Grouped by Projects & Trials.</p>
            </div>
            <div className="flex gap-3">
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

                        <div className="lg:col-span-3">
                          <textarea 
                            placeholder="Project notes..."
                            value={projectNotes[projectName] || ''}
                            onChange={(e) => handleNoteChange(projectName, e.target.value)}
                            className="w-full h-24 bg-[#F8F9FA] border border-[#E1E3E1] rounded-xl p-3 text-xs focus:ring-1 focus:ring-blue-500 outline-none resize-none"
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
                className="bg-white p-6 rounded-3xl border border-[#E1E3E1] shadow-sm"
              >
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold">NPI Timeline</h3>
                  <button 
                    onClick={scrollToToday}
                    className="flex items-center gap-2 px-4 py-2 bg-red-50 text-red-600 rounded-xl text-sm font-bold hover:bg-red-100 transition-all"
                  >
                    <Clock className="w-4 h-4" />
                    Go to Today
                  </button>
                </div>
                <div className="overflow-x-auto" ref={timelineRef}>
                  <GanttChart tasks={filteredTasks} onEdit={setEditingTask} />
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
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[1500px]">
                    <thead className="bg-[#F0F4F8]">
                      <tr>
                        <th className="p-4 font-semibold text-sm sticky left-0 bg-[#F0F4F8] z-10">Project</th>
                        <th className="p-4 font-semibold text-sm">Part No</th>
                        <th className="p-4 font-semibold text-sm">Molder</th>
                        <th className="p-4 font-semibold text-sm">ODM</th>
                        <th className="p-4 font-semibold text-sm">Stage</th>
                        <th className="p-4 font-semibold text-sm">Status</th>
                        <th className="p-4 font-semibold text-sm">T1</th>
                        <th className="p-4 font-semibold text-sm">T2</th>
                        <th className="p-4 font-semibold text-sm">T3</th>
                        <th className="p-4 font-semibold text-sm">T4</th>
                        <th className="p-4 font-semibold text-sm">T5</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((task) => (
                        <tr key={task.id} className="border-t border-[#E1E3E1] hover:bg-gray-50 transition-colors group">
                          <td className="p-4 text-sm font-medium sticky left-0 bg-white group-hover:bg-gray-50 z-10">
                            <input 
                              value={task.project} 
                              onChange={(e) => handleTableEdit(task.id, 'project', e.target.value)}
                              className="bg-transparent border-none outline-none w-full"
                            />
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
                            <input 
                              value={task.latestStatus} 
                              onChange={(e) => handleTableEdit(task.id, 'latestStatus', e.target.value)}
                              className="bg-transparent border-none outline-none w-full"
                            />
                          </td>
                          {['t1', 't2', 't3', 't4', 't5'].map(t => (
                            <td key={t} className="p-4 text-xs">
                              <input 
                                type="date"
                                value={(task.timelinePoints as any)[t] || ''} 
                                onChange={(e) => handleTableEdit(task.id, `timelinePoints.${t}`, e.target.value)}
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
                  <div className="p-6 border-b border-[#E1E3E1]">
                    <h3 className="text-lg font-bold">Issue List (Latest Trial)</h3>
                  </div>
                  <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {filteredTasks.flatMap(t => {
                        if (!t.issues || t.issues.length === 0) return [];
                        // Find the latest trial for this task
                        const trials = Array.from(new Set(t.issues.map(i => i.trial))).sort();
                        const latestTrial = trials[trials.length - 1];
                        return t.issues.filter(i => i.trial === latestTrial);
                      }).map((issue, i) => (
                        <div key={i} className="p-4 bg-gray-50 rounded-2xl border border-[#E1E3E1]">
                          <div className="flex justify-between items-start mb-2">
                            <span className="px-2 py-1 bg-red-100 text-red-700 rounded-lg text-[10px] font-bold uppercase">
                              {issue.trial}
                            </span>
                            <span className={`text-[10px] font-bold uppercase ${
                              issue.severity === 'high' ? 'text-red-600' : 
                              issue.severity === 'medium' ? 'text-orange-600' : 'text-blue-600'
                            }`}>
                              {issue.severity}
                            </span>
                          </div>
                          <p className="text-sm font-medium mb-2">{issue.description}</p>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${issue.status === 'open' ? 'bg-red-500' : 'bg-emerald-500'}`}></div>
                            <span className="text-xs text-gray-500 capitalize">{issue.status}</span>
                          </div>
                        </div>
                      ))}
                      {filteredTasks.every(t => !t.issues || t.issues.length === 0) && (
                        <div className="col-span-full text-center py-10 text-gray-400">
                          No issues found in the latest trial.
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

function GanttChart({ tasks, onEdit }: { tasks: NPITask[], onEdit: (task: NPITask) => void }) {
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

  return (
    <div className="min-w-max">
      <div className="flex border-b border-[#E1E3E1] mb-4 relative">
        <div className="w-64 sticky left-0 bg-white z-10 p-2 font-bold text-sm">Project/Part</div>
        <div className="flex">
          {days.map((day, i) => (
            <div 
              key={i} 
              id={format(day, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd') ? 'today-marker' : undefined}
              className="flex flex-col items-center justify-center text-[10px] text-[#44474E] border-l border-[#F0F0F0]" 
              style={{ width: dayWidth }}
            >
              {format(day, 'd')}
              <span className="opacity-50">{format(day, 'MMM')}</span>
            </div>
          ))}
        </div>
        {/* Today Marker Line */}
        {isWithinInterval(today, { start: minDate, end: maxDate }) && (
          <div 
            className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-20 pointer-events-none animate-pulse"
            style={{ left: 256 + (differenceInDays(today, minDate) || 0) * dayWidth }}
          >
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full"></div>
          </div>
        )}
      </div>
      <div className="space-y-4">
        {validTasks.map((task) => {
          return (
            <div key={task.id} className="flex items-center group">
              <div 
                className="w-64 sticky left-0 bg-white z-10 p-2 text-xs font-medium border-r border-[#E1E3E1] group-hover:bg-gray-50 cursor-pointer whitespace-normal break-words"
                onClick={() => onEdit(task)}
              >
                <div className="font-bold text-blue-600">{task.project}</div>
                {task.projectDescription}
                <div className="text-[10px] opacity-50">{task.partNo}</div>
              </div>
              <div className="relative h-16 flex-1">
                {/* Milestones (Red Dots) */}
                {Object.entries(task.milestones || {}).map(([key, date]) => {
                  if (!date) return null;
                  const d = parseISO(date);
                  if (!isValid(d)) return null;
                  const offset = (differenceInDays(d, minDate) || 0) * dayWidth;
                  if (isNaN(offset)) return null;
                  return (
                    <div 
                      key={key}
                      className="absolute top-2 w-3 h-3 bg-red-600 rounded-full transform -translate-x-1/2 z-10 shadow-sm cursor-pointer hover:scale-125 transition-transform"
                      style={{ left: offset }}
                      onClick={() => onEdit(task)}
                      title={`${key.toUpperCase()}: ${date}`}
                    >
                      <span className="absolute -top-4 left-1/2 transform -translate-x-1/2 text-[8px] font-bold text-red-700 whitespace-nowrap bg-white/80 px-1 rounded">
                        {key.toUpperCase()}
                      </span>
                    </div>
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
                    <div 
                      key={key}
                      className="absolute top-8 w-2 h-2 bg-blue-600 rounded-full transform -translate-x-1/2 z-10 cursor-pointer hover:scale-125 transition-transform"
                      style={{ left: offset }}
                      onClick={() => onEdit(task)}
                      title={`${key.toUpperCase()}: ${date}`}
                    >
                      <span className="absolute top-3 left-1/2 transform -translate-x-1/2 text-[8px] font-bold text-blue-700 whitespace-nowrap bg-white/80 px-1 rounded">
                        {key.toUpperCase()}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
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
