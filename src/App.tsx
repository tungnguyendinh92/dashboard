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
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'timeline' | 'table' | 'ai'>('dashboard');
  const [chatInput, setChatInput] = useState('');
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [googleTokens, setGoogleTokens] = useState<any>(null);
  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [syncing, setSyncing] = useState(false);

  // Load tokens from localStorage on mount
  useEffect(() => {
    const savedTokens = localStorage.getItem('google_tokens');
    if (savedTokens) setGoogleTokens(JSON.parse(savedTokens));
    
    const savedSheetId = localStorage.getItem('spreadsheet_id');
    if (savedSheetId) setSpreadsheetId(savedSheetId);
  }, []);

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
      setTasks(parsedTasks);
      setLoading(false);
    };
    reader.readAsBinaryString(file);
  };

  const handleGoogleAuth = async () => {
    const res = await fetch('/api/auth/google/url');
    const { url } = await res.json();
    window.open(url, 'google_auth', 'width=600,height=700');
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        setGoogleTokens(event.data.tokens);
        localStorage.setItem('google_tokens', JSON.stringify(event.data.tokens));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSyncToSheets = async () => {
    if (!googleTokens || !spreadsheetId || tasks.length === 0) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/sheets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: googleTokens, spreadsheetId, data: tasks })
      });
      if (res.ok) {
        alert('Successfully synced to Google Sheets!');
      } else {
        alert('Sync failed. Please check your Spreadsheet ID.');
      }
    } catch (error) {
      console.error(error);
    } finally {
      setSyncing(false);
    }
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
    completed: tasks.filter(t => t.status === 'Completed').length,
    inProgress: tasks.filter(t => t.status === 'In Progress').length,
    delayed: tasks.filter(t => t.status === 'Delayed').length,
  };

  const pieData = [
    { name: 'Completed', value: stats.completed },
    { name: 'In Progress', value: stats.inProgress },
    { name: 'Pending', value: tasks.filter(t => t.status === 'Pending').length },
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
          <div className="bg-[#F0F4F8] rounded-2xl p-4">
            <h3 className="text-xs font-semibold text-[#44474E] uppercase tracking-wider mb-3">Google Sheets Sync</h3>
            {!googleTokens ? (
              <button 
                onClick={handleGoogleAuth}
                className="w-full flex items-center justify-center gap-2 bg-white border border-[#C4C7C5] py-2 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                <LogIn className="w-4 h-4" /> Connect Google
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <input 
                  type="text" 
                  placeholder="Spreadsheet ID"
                  value={spreadsheetId}
                  onChange={(e) => {
                    setSpreadsheetId(e.target.value);
                    localStorage.setItem('spreadsheet_id', e.target.value);
                  }}
                  className="w-full bg-white border border-[#C4C7C5] px-3 py-2 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button 
                  onClick={handleSyncToSheets}
                  disabled={syncing || !spreadsheetId}
                  className="w-full flex items-center justify-center gap-2 bg-[#0061A4] text-white py-2 rounded-xl text-sm font-medium hover:bg-[#004A7D] transition-colors disabled:opacity-50"
                >
                  {syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                  Sync Now
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 p-8 min-h-screen">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold text-[#1A1C1E]">NPI Schedule Dashboard</h2>
            <p className="text-[#44474E]">Manage and visualize your product introduction timeline.</p>
          </div>
          <label className="flex items-center gap-2 bg-[#0061A4] text-white px-6 py-3 rounded-2xl font-semibold cursor-pointer hover:bg-[#004A7D] transition-all shadow-lg shadow-blue-100 active:scale-95">
            <Upload className="w-5 h-5" />
            Upload Excel
            <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
          </label>
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
                className="grid grid-cols-1 md:grid-cols-4 gap-6"
              >
                <StatCard label="Total Tasks" value={stats.total} icon={<FileSpreadsheet className="text-blue-600" />} />
                <StatCard label="Completed" value={stats.completed} icon={<CheckCircle2 className="text-emerald-600" />} />
                <StatCard label="In Progress" value={stats.inProgress} icon={<Clock className="text-blue-500" />} />
                <StatCard label="Delayed" value={stats.delayed} icon={<AlertCircle className="text-red-500" />} />

                <div className="md:col-span-2 bg-white p-6 rounded-3xl border border-[#E1E3E1] shadow-sm">
                  <h3 className="text-lg font-bold mb-6">Task Status Distribution</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {pieData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="md:col-span-2 bg-white p-6 rounded-3xl border border-[#E1E3E1] shadow-sm">
                  <h3 className="text-lg font-bold mb-6">Progress Overview</h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={tasks.slice(0, 8)}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F0F0F0" />
                        <XAxis dataKey="task" tick={{fontSize: 10}} />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="progress" fill="#0061A4" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
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
                <GanttChart tasks={tasks} />
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
                <table className="w-full text-left border-collapse">
                  <thead className="bg-[#F0F4F8]">
                    <tr>
                      <th className="p-4 font-semibold text-sm">Task Name</th>
                      <th className="p-4 font-semibold text-sm">Owner</th>
                      <th className="p-4 font-semibold text-sm">Start Date</th>
                      <th className="p-4 font-semibold text-sm">End Date</th>
                      <th className="p-4 font-semibold text-sm">Status</th>
                      <th className="p-4 font-semibold text-sm">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => (
                      <tr key={task.id} className="border-t border-[#E1E3E1] hover:bg-gray-50 transition-colors">
                        <td className="p-4 text-sm font-medium">{task.task}</td>
                        <td className="p-4 text-sm text-[#44474E]">{task.owner}</td>
                        <td className="p-4 text-sm text-[#44474E]">{task.startDate}</td>
                        <td className="p-4 text-sm text-[#44474E]">{task.endDate}</td>
                        <td className="p-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            task.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' :
                            task.status === 'In Progress' ? 'bg-blue-100 text-blue-700' :
                            task.status === 'Delayed' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-700'
                          }`}>
                            {task.status}
                          </span>
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
                        msg.role === 'user' ? 'bg-[#0061A4] text-white' : 'bg-[#F0F4F8] text-[#1A1C1E]'
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

  return (
    <div className="min-w-max">
      <div className="flex border-b border-[#E1E3E1] mb-4">
        <div className="w-64 sticky left-0 bg-white z-10 p-2 font-bold text-sm">Task</div>
        <div className="flex">
          {days.map((day, i) => (
            <div key={i} className="flex flex-col items-center justify-center text-[10px] text-[#44474E] border-l border-[#F0F0F0]" style={{ width: dayWidth }}>
              {format(day, 'd')}
              <span className="opacity-50">{format(day, 'MMM')}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {tasks.map((task) => {
          const start = parseISO(task.startDate);
          const end = parseISO(task.endDate);
          const leftOffset = differenceInDays(start, minDate) * dayWidth;
          const width = (differenceInDays(end, start) + 1) * dayWidth;

          return (
            <div key={task.id} className="flex items-center group">
              <div className="w-64 sticky left-0 bg-white z-10 p-2 text-xs font-medium truncate border-r border-[#E1E3E1] group-hover:bg-gray-50">
                {task.task}
              </div>
              <div className="relative h-8 flex-1">
                <div 
                  className={`absolute h-6 top-1 rounded-lg shadow-sm flex items-center px-2 text-[10px] font-bold text-white overflow-hidden ${
                    task.status === 'Completed' ? 'bg-emerald-500' :
                    task.status === 'In Progress' ? 'bg-blue-500' :
                    task.status === 'Delayed' ? 'bg-red-500' :
                    'bg-gray-400'
                  }`}
                  style={{ left: leftOffset, width: width }}
                >
                  <div className="absolute left-0 top-0 h-full bg-black/10" style={{ width: `${task.progress}%` }}></div>
                  <span className="relative z-10 truncate">{task.progress}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
