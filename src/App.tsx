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
import { format, parseISO, differenceInDays, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isWithinInterval } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import { parseExcelDataWithAI, askAIAboutSchedule, NPITask } from './services/geminiService';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'];

export default function App() {
  const [tasks, setTasks] = useState<NPITask[]>([]);
  const [prevTasks, setPrevTasks] = useState<NPITask[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'timeline' | 'table' | 'ai'>('dashboard');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [googleSheetUrl, setGoogleSheetUrl] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [projectNotes, setProjectNotes] = useState<Record<string, string>>({});

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
      setPrevTasks(tasks);
      setTasks(parsedTasks);
      setLoading(false);
    };
    reader.readAsBinaryString(file);
  };

  const filteredTasks = tasks.filter(t => 
    t.projectDescription.toLowerCase().includes(filterText.toLowerCase()) ||
    t.partNo.toLowerCase().includes(filterText.toLowerCase())
  );

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
    setChatHistory(prev => [...prev, { role: 'ai', content: aiResponse }]);
  };

  const stats = {
    total: tasks.length,
    completed: tasks.filter(t => t.progress === 100).length,
    inProgress: tasks.filter(t => t.progress > 0 && t.progress < 100).length,
    delayed: tasks.filter(t => t.latestStatus?.toLowerCase().includes('delay')).length,
  };

  const pieData = [
    { name: 'Completed', value: stats.completed },
    { name: 'In Progress', value: stats.inProgress },
    { name: 'Pending', value: tasks.filter(t => t.progress === 0).length },
    { name: 'Delayed', value: stats.delayed },
  ];

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
          <NavItem active={activeTab === 'ai'} onClick={() => setActiveTab('ai')} icon={<MessageSquare />} label="AI Assistant" />
        </nav>

        <div className="mt-auto pt-6 border-t border-[#E1E3E1]">
          <button 
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[#44474E] hover:bg-gray-100 transition-all font-medium"
          >
            <Settings className="w-5 h-5" />
            Settings
          </button>
        </div>
      </aside>

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
                  <label className="block text-sm font-semibold text-[#44474E] mb-2">Google Sheet URL</label>
                  <input 
                    type="text" 
                    value={googleSheetUrl}
                    onChange={(e) => {
                      setGoogleSheetUrl(e.target.value);
                      localStorage.setItem('google_sheet_url', e.target.value);
                    }}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="w-full bg-[#F0F4F8] border-none rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div className="bg-blue-50 p-4 rounded-xl">
                  <h4 className="text-xs font-bold text-blue-800 mb-2 uppercase">Google Apps Script Sync (Manual)</h4>
                  <p className="text-[10px] text-blue-700 mb-2">
                    If direct sync fails, you can use this script in your Google Sheet (Extensions {'>'} Apps Script):
                  </p>
                  <pre className="text-[9px] bg-white/50 p-2 rounded border border-blue-200 overflow-x-auto max-h-32">
{`function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.clear();
  // Add headers and data logic here...
  return ContentService.createTextOutput("Success");
}`}
                  </pre>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full bg-[#0061A4] text-white py-3 rounded-xl font-bold hover:bg-[#004A7D] transition-all"
                >
                  Save & Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="ml-64 p-8 min-h-screen">
        <header className="flex flex-col gap-6 mb-8">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-3xl font-bold text-[#1A1C1E]">NPI Schedule Dashboard</h2>
              <p className="text-[#44474E]">Manage and visualize your product introduction timeline.</p>
            </div>
            <label className="flex items-center gap-2 bg-[#0061A4] text-white px-6 py-3 rounded-2xl font-semibold cursor-pointer hover:bg-[#004A7D] transition-all shadow-lg shadow-blue-100 active:scale-95">
              <Upload className="w-5 h-5" />
              Upload Excel
              <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <div className="bg-white p-2 rounded-2xl border border-[#E1E3E1] flex items-center gap-3 shadow-sm">
            <div className="pl-4 text-gray-400"><LayoutDashboard className="w-5 h-5" /></div>
            <input 
              type="text" 
              placeholder="Filter by Project Name or Part No..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none py-2 text-sm"
            />
          </div>
        </header>

        {loading ? (
          <div className="flex flex-col items-center justify-center h-[60vh]">
            <RefreshCw className="w-12 h-12 text-[#0061A4] animate-spin mb-4" />
            <p className="text-lg font-medium text-[#44474E]">AI is analyzing your schedule...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[60vh] border-2 border-dashed border-[#C4C7C5] rounded-3xl bg-white">
            <FileSpreadsheet className="w-16 h-16 text-[#C4C7C5] mb-4" />
            <h3 className="text-xl font-bold text-[#1A1C1E]">No Data Available</h3>
            <p className="text-[#44474E]">Upload an Excel file to get started with AI analysis.</p>
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
                  <StatCard label="Total Projects" value={filteredTasks.length} icon={<FileSpreadsheet className="text-blue-600" />} />
                  <StatCard label="Avg Progress" value={`${Math.round(filteredTasks.reduce((acc, t) => acc + t.progress, 0) / (filteredTasks.length || 1))}%`} icon={<CheckCircle2 className="text-emerald-600" />} />
                  <StatCard label="Active Stages" value={new Set(filteredTasks.map(t => t.currentStage)).size} icon={<Clock className="text-blue-500" />} />
                  <StatCard label="Alerts" value={filteredTasks.filter(t => t.latestStatus?.toLowerCase().includes('delay')).length} icon={<AlertCircle className="text-red-500" />} />
                </div>

                <div className="bg-white rounded-3xl border border-[#E1E3E1] shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-[#E1E3E1] flex justify-between items-center">
                    <h3 className="text-lg font-bold">Overall Project Status</h3>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                      Today Marker
                    </div>
                  </div>
                  <div className="p-6 space-y-8">
                    {filteredTasks.map(task => (
                      <div key={task.id} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start pb-8 border-b border-[#F0F0F0] last:border-0">
                        <div className="lg:col-span-3">
                          <h4 className="font-bold text-[#1A1C1E]">{task.projectDescription}</h4>
                          <p className="text-xs text-gray-500 mb-2">{task.partNo}</p>
                          <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-bold uppercase">
                            {task.currentStage}
                          </span>
                        </div>
                        
                        <div className="lg:col-span-6">
                          <ProjectMiniTimeline task={task} />
                        </div>

                        <div className="lg:col-span-3">
                          <textarea 
                            placeholder="Project notes..."
                            value={projectNotes[task.id] || ''}
                            onChange={(e) => handleNoteChange(task.id, e.target.value)}
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
                className="bg-white p-6 rounded-3xl border border-[#E1E3E1] shadow-sm overflow-x-auto"
              >
                <GanttChart tasks={filteredTasks} />
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
                  <table className="w-full text-left border-collapse min-w-[1200px]">
                    <thead className="bg-[#F0F4F8]">
                      <tr>
                        <th className="p-4 font-semibold text-sm sticky left-0 bg-[#F0F4F8] z-10">Project/Part Description</th>
                        <th className="p-4 font-semibold text-sm">Part No</th>
                        <th className="p-4 font-semibold text-sm">Molder</th>
                        <th className="p-4 font-semibold text-sm">ODM</th>
                        <th className="p-4 font-semibold text-sm">Current Stage</th>
                        <th className="p-4 font-semibold text-sm">Latest Status</th>
                        <th className="p-4 font-semibold text-sm">Milestones</th>
                        <th className="p-4 font-semibold text-sm">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((task) => (
                        <tr key={task.id} className="border-t border-[#E1E3E1] hover:bg-gray-50 transition-colors group">
                          <td className="p-4 text-sm font-medium sticky left-0 bg-white group-hover:bg-gray-50 z-10">{task.projectDescription}</td>
                          <td className="p-4 text-sm text-[#44474E]">{task.partNo}</td>
                          <td className="p-4 text-sm text-[#44474E]">{task.molder}</td>
                          <td className="p-4 text-sm text-[#44474E]">{task.odm}</td>
                          <td className="p-4 text-sm text-[#44474E] font-semibold">{task.currentStage}</td>
                          <td className={`p-4 text-sm font-medium ${isStatusUpdated(task) ? 'text-blue-600' : 'text-[#44474E]'}`}>
                            {task.latestStatus}
                          </td>
                          <td className="p-4 text-xs">
                            <div className="flex flex-col gap-1">
                              {task.milestones?.beta && <span>B: {task.milestones.beta}</span>}
                              {task.milestones?.pilotRun && <span>P: {task.milestones.pilotRun}</span>}
                              {task.milestones?.mp && <span>M: {task.milestones.mp}</span>}
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${task.progress}%` }}></div>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {activeTab === 'ai' && (
              <motion.div 
                key="ai"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white p-6 rounded-3xl border border-[#E1E3E1] shadow-sm h-[70vh] flex flex-col"
              >
                <div className="flex-1 overflow-y-auto mb-4 space-y-4 pr-2">
                  {chatHistory.length === 0 && (
                    <div className="text-center mt-20 text-[#44474E]">
                      <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-20" />
                      <p>Ask me anything about your NPI schedule.</p>
                      <p className="text-sm opacity-60">"Which tasks are delayed?" or "Who is the owner of Task X?"</p>
                    </div>
                  )}
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] p-4 rounded-2xl ${
                        msg.role === 'user' ? 'bg-[#E3F2FD] text-[#0D47A1]' : 'bg-[#F0F4F8] text-[#1A1C1E]'
                      }`}>
                        <div className="markdown-body prose prose-sm max-w-none">
                          <ReactMarkdown>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleChat()}
                    placeholder="Ask AI about the schedule..."
                    className="flex-1 bg-[#F0F4F8] border-none rounded-2xl px-6 py-3 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <button 
                    onClick={handleChat}
                    className="bg-[#0061A4] text-white p-3 rounded-2xl hover:bg-[#004A7D] transition-all"
                  >
                    <Send className="w-6 h-6" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>
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

function GanttChart({ tasks }: { tasks: NPITask[] }) {
  if (tasks.length === 0) return null;

  const startDates = tasks.map(t => parseISO(t.startDate));
  const endDates = tasks.map(t => parseISO(t.endDate));
  const minDate = startOfMonth(new Date(Math.min(...startDates.map(d => d.getTime()))));
  const maxDate = endOfMonth(new Date(Math.max(...endDates.map(d => d.getTime()))));
  
  const days = eachDayOfInterval({ start: minDate, end: maxDate });
  const dayWidth = 40;
  const today = new Date();

  return (
    <div className="min-w-max">
      <div className="flex border-b border-[#E1E3E1] mb-4 relative">
        <div className="w-64 sticky left-0 bg-white z-10 p-2 font-bold text-sm">Project/Part</div>
        <div className="flex">
          {days.map((day, i) => (
            <div key={i} className="flex flex-col items-center justify-center text-[10px] text-[#44474E] border-l border-[#F0F0F0]" style={{ width: dayWidth }}>
              {format(day, 'd')}
              <span className="opacity-50">{format(day, 'MMM')}</span>
            </div>
          ))}
        </div>
        {/* Today Marker Line */}
        {isWithinInterval(today, { start: minDate, end: maxDate }) && (
          <div 
            className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-20 pointer-events-none animate-pulse"
            style={{ left: 256 + differenceInDays(today, minDate) * dayWidth }}
          >
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full"></div>
          </div>
        )}
      </div>
      <div className="space-y-4">
        {tasks.map((task) => {
          return (
            <div key={task.id} className="flex items-center group">
              <div className="w-64 sticky left-0 bg-white z-10 p-2 text-xs font-medium truncate border-r border-[#E1E3E1] group-hover:bg-gray-50">
                {task.projectDescription}
                <div className="text-[10px] opacity-50">{task.partNo}</div>
              </div>
              <div className="relative h-16 flex-1">
                {/* Milestones (Red Dots) */}
                {Object.entries(task.milestones || {}).map(([key, date]) => {
                  if (!date) return null;
                  const d = parseISO(date);
                  const offset = differenceInDays(d, minDate) * dayWidth;
                  return (
                    <div 
                      key={key}
                      className="absolute top-2 w-3 h-3 bg-red-600 rounded-full transform -translate-x-1/2 z-10 shadow-sm"
                      style={{ left: offset }}
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
                  const offset = differenceInDays(d, minDate) * dayWidth;
                  return (
                    <div 
                      key={key}
                      className="absolute top-8 w-2 h-2 bg-blue-600 rounded-full transform -translate-x-1/2 z-10"
                      style={{ left: offset }}
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
  const startDates = [task.startDate, ...Object.values(task.milestones || {}), ...Object.values(task.timelinePoints || {})]
    .filter(Boolean).map(d => parseISO(d!));
  const endDates = [task.endDate, ...Object.values(task.milestones || {}), ...Object.values(task.timelinePoints || {})]
    .filter(Boolean).map(d => parseISO(d!));
  
  const minDate = startOfMonth(new Date(Math.min(...startDates.map(d => d.getTime()))));
  const maxDate = endOfMonth(new Date(Math.max(...endDates.map(d => d.getTime()))));
  const totalDays = differenceInDays(maxDate, minDate) || 1;
  const today = new Date();

  return (
    <div className="relative h-16 bg-gray-50 rounded-xl p-2 overflow-hidden border border-[#F0F0F0]">
      {/* Today Marker */}
      {isWithinInterval(today, { start: minDate, end: maxDate }) && (
        <div 
          className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-20 animate-pulse"
          style={{ left: `${(differenceInDays(today, minDate) / totalDays) * 100}%` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full"></div>
        </div>
      )}

      {/* Milestones */}
      {Object.entries(task.milestones || {}).map(([key, date]) => {
        if (!date) return null;
        const d = parseISO(date);
        const pos = (differenceInDays(d, minDate) / totalDays) * 100;
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
        const pos = (differenceInDays(d, minDate) / totalDays) * 100;
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
