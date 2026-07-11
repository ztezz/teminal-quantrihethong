'use client';

// Backend API base URL — đặt NEXT_PUBLIC_API_URL trong .env khi deploy frontend riêng
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Terminal as TerminalIcon, 
  Lock, 
  Settings, 
  History, 
  LogOut, 
  Key, 
  RefreshCw, 
  Database, 
  Check, 
  AlertCircle,
  Menu,
  X,
  Plus,
  Minus,
  Folder,
  File,
  FolderPlus,
  FilePlus,
  Trash2,
  ArrowLeft,
  ChevronRight,
  Edit,
  Eye,
  Save,
  ArrowUpLeft,
  FileCode,
  FileText,
  FileJson,
  FileClock,
  Download,
  Search
} from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

interface LogEntry {
  event: string;
  ip: string;
  timestamp: string;
}

// Helper to determine the proper file-type specific icon and color styling
function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'sh':
    case 'bash':
      return <FileCode className="w-4 h-4 shrink-0 text-emerald-400" />;
    case 'txt':
    case 'md':
      return <FileText className="w-4 h-4 shrink-0 text-slate-400" />;
    case 'json':
      return <FileJson className="w-4 h-4 shrink-0 text-blue-400" />;
    case 'log':
      return <FileClock className="w-4 h-4 shrink-0 text-amber-500" />;
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'py':
    case 'go':
    case 'rs':
    case 'c':
    case 'cpp':
    case 'html':
    case 'css':
      return <FileCode className="w-4 h-4 shrink-0 text-purple-400" />;
    default:
      return <File className="w-4 h-4 shrink-0 text-slate-500" />;
  }
}

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Terminal customization preferences
  const [fontSize, setFontSize] = useState<number>(14);
  const [theme, setTheme] = useState<string>('dark-classic');
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);
  const activePreviewTheme = previewTheme !== null ? previewTheme : theme;

  // Save Status for Settings (SQLite Auto-save)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSettingsLoadedRef = useRef<boolean>(false);

  // Logs & Settings Management UI State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'terminal' | 'logs' | 'settings' | 'files'>('terminal');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // System metrics
  const [cpuPercent, setCpuPercent] = useState<number>(0);
  const [memUsedMB, setMemUsedMB] = useState<number>(0);
  const [memTotalMB, setMemTotalMB] = useState<number>(0);
  const [memPercent, setMemPercent] = useState<number>(0);

  // File Manager States
  const [filesList, setFilesList] = useState<any[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string>('');
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isEditingFile, setIsEditingFile] = useState<boolean>(false);
  const [fileLoading, setFileLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState<boolean>(false);
  const [showCreateFile, setShowCreateFile] = useState<boolean>(false);
  const [newDirName, setNewDirName] = useState<string>('');
  const [newFileName, setNewFileName] = useState<string>('');
  const [fileSearchQuery, setFileSearchQuery] = useState<string>('');

  const filteredFiles = filesList.filter((file) =>
    file.name.toLowerCase().includes(fileSearchQuery.toLowerCase())
  );

  const loadFiles = useCallback(async (dirPath?: string, authToken = token) => {
    const auth = authToken || token;
    if (!auth) return;
    setFileLoading(true);
    setFileError(null);
    setFileSearchQuery('');
    try {
      const url = dirPath ? `${API_URL}/api/files?path=${encodeURIComponent(dirPath)}` : `${API_URL}/api/files`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${auth}` }
      });
      const data = await res.json();
      if (data.success) {
        setFilesList(data.files);
        setCurrentPath(data.currentPath);
        setParentPath(data.parentPath);
      } else {
        setFileError(data.error || 'Không thể tải danh sách tệp tin');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối đến máy chủ: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  }, [token]);

  const openFile = async (filePath: string) => {
    if (!token) return;
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetch(`${API_URL}/api/files/read?path=${encodeURIComponent(filePath)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        if (data.isBinary) {
          setFileError('Tệp tin này là định dạng nhị phân, không thể xem trực tiếp.');
          setViewingFile(null);
          setFileContent(null);
        } else {
          setViewingFile(filePath);
          setFileContent(data.content);
          setIsEditingFile(false);
        }
      } else {
        setFileError(data.error || 'Không thể mở tệp tin');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối máy chủ: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const saveEditedFile = async () => {
    if (!token || !viewingFile || fileContent === null) return;
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetch(`${API_URL}/api/files/write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ filePath: viewingFile, content: fileContent })
      });
      const data = await res.json();
      if (data.success) {
        setIsEditingFile(false);
      } else {
        setFileError(data.error || 'Lỗi khi lưu tệp tin');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const deleteFileOrFolder = async (filePath: string) => {
    if (!token) return;
    const itemName = filePath.replace(/\\/g, '/').split('/').pop() || 'tệp/thư mục';
    if (!confirm(`Bạn có chắc chắn muốn xóa "${itemName}" không?`)) return;
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetch(`${API_URL}/api/files?path=${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        loadFiles(currentPath);
        if (viewingFile === filePath) {
          setViewingFile(null);
          setFileContent(null);
        }
      } else {
        setFileError(data.error || 'Lỗi khi xóa tệp/thư mục');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const createNewDir = async () => {
    if (!token || !newDirName.trim()) return;
    setFileLoading(true);
    setFileError(null);
    try {
      const res = await fetch(`${API_URL}/api/files/mkdir`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ dirPath: currentPath, name: newDirName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        setNewDirName('');
        setShowCreateFolder(false);
        loadFiles(currentPath);
      } else {
        setFileError(data.error || 'Lỗi tạo thư mục mới');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  const createNewFile = async () => {
    if (!token || !newFileName.trim()) return;
    setFileLoading(true);
    setFileError(null);
    const fullFilePath = currentPath + (currentPath.endsWith('/') || currentPath.endsWith('\\') ? '' : '/') + newFileName.trim();
    try {
      const res = await fetch(`${API_URL}/api/files/write`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ filePath: fullFilePath, content: '' })
      });
      const data = await res.json();
      if (data.success) {
        setNewFileName('');
        setShowCreateFile(false);
        loadFiles(currentPath);
        openFile(fullFilePath);
      } else {
        setFileError(data.error || 'Lỗi tạo tệp mới');
      }
    } catch (err: any) {
      setFileError('Lỗi kết nối: ' + err.message);
    } finally {
      setFileLoading(false);
    }
  };

  // Password Change State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  // Terminal and socket refs
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<any>(null);
  const socketInstance = useRef<Socket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Stable refs to always access latest fontSize/theme inside effects without adding them as deps
  const fontSizeRef = useRef<number>(fontSize);
  const themeRef = useRef<string>(theme);
  useEffect(() => { fontSizeRef.current = fontSize; }, [fontSize]);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const autoScrollRef = useRef<boolean>(true);

  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  const exportTerminalHistory = () => {
    if (!xtermInstance.current) return;
    try {
      const activeBuffer = xtermInstance.current.buffer.active;
      let text = '';
      for (let i = 0; i < activeBuffer.length; i++) {
        const line = activeBuffer.getLine(i);
        if (line) {
          text += line.translateToString(true) + '\n';
        }
      }
      
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.id = 'download-temp-link';
      link.href = url;
      link.download = `terminal_scrollback_${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Lỗi khi xuất dữ liệu terminal:', err);
    }
  };

  const clearTerminal = () => {
    if (xtermInstance.current) {
      xtermInstance.current.clear();
      xtermInstance.current.focus();
    }
  };

  const handleInsertCommand = (cmd: string) => {
    if (socketInstance.current && socketInstance.current.connected) {
      socketInstance.current.emit('input', cmd + '\r');
      if (xtermInstance.current) {
        xtermInstance.current.focus();
      }
    }
  };

  // Fetch log history and current preferences
  const loadLogs = async (authToken = token) => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_URL}/api/logs`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs);
      }
    } catch (err) {
      console.error('Failed to load logs:', err);
    }
  };

  const loadMetrics = useCallback(async (authToken = token) => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_URL}/api/metrics`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success) {
        setCpuPercent(data.cpu);
        setMemUsedMB(data.memUsedMB);
        setMemTotalMB(data.memTotalMB);
        setMemPercent(data.memPercent);
      }
    } catch (err) {
      // Silently ignore metrics errors
    }
  }, [token]);

  const loadSettings = useCallback(async (authToken = token) => {
    if (!authToken) return;
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      const data = await res.json();
      if (data.success && data.settings) {
        setFontSize(parseInt(data.settings.fontSize) || 14);
        setTheme(data.settings.theme || 'dark-classic');
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    } finally {
      // Mark settings as loaded after initial load triggers state updates
      setTimeout(() => {
        isSettingsLoadedRef.current = true;
      }, 300);
    }
  }, [token]);

  const saveSettings = useCallback(async (newSize: number, newTheme: string) => {
    if (!token) return;
    const shouldShowStatus = isSettingsLoadedRef.current;
    if (shouldShowStatus) {
      Promise.resolve().then(() => {
        setSaveStatus('saving');
      });
    }
    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ fontSize: newSize, theme: newTheme })
      });
      const data = await res.json();
      if (data.success) {
        if (shouldShowStatus) {
          setSaveStatus('saved');
          if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
          }
          saveTimeoutRef.current = setTimeout(() => {
            setSaveStatus('idle');
          }, 3000);
        }
      } else {
        if (shouldShowStatus) {
          setSaveStatus('error');
        }
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      if (shouldShowStatus) {
        setSaveStatus('error');
      }
    }
  }, [token]);

  // Check if session already exists on load
  useEffect(() => {
    const savedToken = localStorage.getItem('vps_terminal_token');
    if (savedToken) {
      setTimeout(() => setLoading(true), 0);
      fetch(`${API_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: savedToken })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setToken(savedToken);
          setIsAuthenticated(true);
        loadSettings(savedToken);
          loadFiles('', savedToken);
        } else {
          localStorage.removeItem('vps_terminal_token');
          setIsAuthenticated(false);
        }
      })
      .catch(() => {
        setIsAuthenticated(false);
      })
      .finally(() => {
        setLoading(false);
      });
    } else {
      setTimeout(() => setIsAuthenticated(false), 0);
    }
  }, [loadSettings, loadFiles]);

  // Handle master password validation
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();

      if (data.success) {
        localStorage.setItem('vps_terminal_token', data.token);
        setToken(data.token);
        setIsAuthenticated(true);
        loadSettings(data.token);
        loadLogs(data.token);
        loadFiles('', data.token);
      } else {
        setError(data.error || 'Authentication failed');
      }
    } catch (err) {
      setError('Connection to server authentication API failed');
    } finally {
      setLoading(false);
    }
  };

  // Handle password modification
  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (newPassword !== confirmPassword) {
      setPwdError('New passwords do not match');
      return;
    }

    if (newPassword.length < 5) {
      setPwdError('New password must be at least 5 characters long');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/password`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json();

      if (data.success) {
        setPwdSuccess('Master password changed successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        loadLogs();
      } else {
        setPwdError(data.error || 'Failed to change password');
      }
    } catch (err) {
      setPwdError('Server connection error during password update');
    } finally {
      setLoading(false);
    }
  };

  // Handle Logout
  const handleLogout = async () => {
    if (socketInstance.current) {
      socketInstance.current.disconnect();
    }
    
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
    } catch (e) {
      console.error(e);
    }

    localStorage.removeItem('vps_terminal_token');
    setToken(null);
    setIsAuthenticated(false);
    setPassword('');
  };

  // Convert theme keys to xterm configuration colors
  const getTerminalColors = (themeKey: string) => {
    switch (themeKey) {
      case 'matrix':
        return {
          background: '#02120b',
          foreground: '#39ff14',
          cursor: '#39ff14',
          black: '#000000',
          red: '#ff5555',
          green: '#39ff14',
          yellow: '#ffb86c',
          blue: '#bd93f9',
          magenta: '#ff79c6',
          cyan: '#8be9fd',
          white: '#f8f8f2',
        };
      case 'amber':
        return {
          background: '#120b00',
          foreground: '#ffb200',
          cursor: '#ffb200',
          black: '#000000',
          red: '#d9534f',
          green: '#5cb85c',
          yellow: '#f0ad4e',
          blue: '#0275d8',
          magenta: '#e11d48',
          cyan: '#5bc0de',
          white: '#f7f7f7',
        };
      case 'cyberpunk':
        return {
          background: '#13001c',
          foreground: '#00ffff',
          cursor: '#ff007f',
          black: '#1a1a24',
          red: '#ff0055',
          green: '#00ff66',
          yellow: '#ffe600',
          blue: '#0099ff',
          magenta: '#ff00ff',
          cyan: '#00ffff',
          white: '#ffffff',
        };
      case 'dark-classic':
      default:
        return {
          background: '#0f172a', // slate-900
          foreground: '#f8fafc', // slate-50
          cursor: '#38bdf8', // sky-400
          black: '#1e293b',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#f1f5f9',
        };
    }
  };

  // Main Terminal Mounting & Socket Connection logic
  useEffect(() => {
    if (!isAuthenticated || !token || !terminalRef.current || activeTab !== 'terminal') {
      // Disconnect socket if navigating away from terminal tab
      if (socketInstance.current) {
        socketInstance.current.disconnect();
        socketInstance.current = null;
      }
      if (xtermInstance.current) {
        xtermInstance.current.dispose();
        xtermInstance.current = null;
      }
      return;
    }

    let isMounted = true;
    let term: any = null;
    let fitAddon: any = null;
    let socket: Socket | null = null;

    const setupTerminal = async () => {
      // Load Xterm.js packages dynamically to prevent server-side errors
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      if (!isMounted || !terminalRef.current) return;

      // Create new terminal instance
      term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: '"JetBrains Mono", "Fira Code", Courier, monospace',
        fontSize: fontSizeRef.current,
        lineHeight: 1.25,
        theme: getTerminalColors(themeRef.current),
        scrollback: 5000,
        allowProposedApi: true
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      
      // Force instant resize computation
      setTimeout(() => {
        if (isMounted && fitAddon) {
          fitAddon.fit();
        }
      }, 150);

      xtermInstance.current = term;

      // Welcome Banner in terminal
      term.writeln('\x1b[38;5;86m╔═════════════════════════════════════════════════════════════╗\x1b[0m');
      term.writeln('\x1b[38;5;86m║             SELF-HOSTED WEB VPS SHELL TERMINAL              ║\x1b[0m');
      term.writeln('\x1b[38;5;86m╚═════════════════════════════════════════════════════════════╝\x1b[0m');
      term.writeln('\x1b[33mConnecting to local VPS shell process...\x1b[0m');

      // Establish socket.io connection with auth token
      socket = io(API_URL || undefined, {
        auth: { token },
        reconnectionDelay: 2000,
        reconnectionDelayMax: 5000,
        timeout: 10000,
      });

      socketInstance.current = socket;

      // Connection state listeners
      socket.on('connect', () => {
        term.writeln('\x1b[32m✔ Connected to real-time process manager successfully.\x1b[0m');
        term.writeln('\x1b[90mPress Enter to start interacting with the terminal.\x1b[0m\r\n');
      });

      socket.on('connect_error', (err) => {
        term.writeln(`\r\n\x1b[31m✖ Connection failed: ${err.message}\x1b[0m\r\n`);
      });

      // Stream data from server to terminal
      socket.on('output', (data: string) => {
        if (term) {
          if (autoScrollRef.current) {
            term.write(data);
            term.scrollToBottom();
          } else {
            const previousViewportY = term.buffer.active.viewportY;
            term.write(data);
            term.scrollToLine(previousViewportY);
          }
        }
      });

      // Forward user keyboard input to server shell
      term.onData((data: string) => {
        if (socket && socket.connected) {
          socket.emit('input', data);
        }
      });

      // Observe terminal panel resize and communicate dimensions
      if (typeof window !== 'undefined') {
        resizeObserverRef.current = new ResizeObserver(() => {
          if (isMounted && fitAddon) {
            try {
              fitAddon.fit();
            } catch (e) {
              // Ignore occasional race dimension fitting errors on fast toggling
            }
          }
        });
        resizeObserverRef.current.observe(terminalRef.current);
      }
    };

    setupTerminal();

    return () => {
      isMounted = false;
      if (socket) {
        socket.disconnect();
      }
      if (term) {
        term.dispose();
      }
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      }
    };
  }, [isAuthenticated, token, activeTab]);

  // Handle dynamic font size or theme adjustment in living terminal
  useEffect(() => {
    if (xtermInstance.current) {
      xtermInstance.current.options.fontSize = fontSize;
      xtermInstance.current.options.theme = getTerminalColors(theme);
      // Wait for font styling to re-render in container, then fit
      setTimeout(() => {
        try {
          const { FitAddon } = require('@xterm/addon-fit');
          const fitAddon = new FitAddon();
          xtermInstance.current.loadAddon(fitAddon);
          fitAddon.fit();
        } catch (e) {}
      }, 50);
    }
    setTimeout(() => {
      saveSettings(fontSize, theme);
    }, 0);
  }, [fontSize, theme, saveSettings]);

  // Poll system metrics every 5 seconds when authenticated
  useEffect(() => {
    if (!isAuthenticated || !token) return;
    // Use setTimeout(0) to avoid setState-in-effect lint error
    const initialTimer = setTimeout(() => loadMetrics(token), 0);
    const interval = setInterval(() => loadMetrics(token), 5000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isAuthenticated, token, loadMetrics]);

  // Loading indicator for verification check
  if (isAuthenticated === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0c] text-slate-100 font-sans">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-4" />
        <p className="text-sm text-slate-400">Đang xác thực phiên bảo mật...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a0c] text-slate-300 font-sans selection:bg-blue-500/30 selection:text-white">
      <AnimatePresence mode="wait">
        {!isAuthenticated ? (
          // 1. Sleek Password Protected Authorization Screen
          <motion.div
            key="login"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="fixed inset-0 bg-[#0a0a0c] flex items-center justify-center p-6 z-50 overflow-y-auto"
          >
            <div className="w-full max-w-md p-8 bg-[#16161d] border border-white/10 rounded-xl shadow-2xl shadow-black relative overflow-hidden">
              {/* Subtle top decoration glow */}
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
              
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-500/10 mb-4 border border-blue-500/20">
                  <Lock className="w-6 h-6 text-blue-500" />
                </div>
                <h2 className="text-lg font-semibold text-white tracking-tight">Yêu Cầu Xác Thực</h2>
                <p className="text-sm text-slate-500 mt-1">Nhập khóa truy cập VPS để khởi tạo Node-PTY</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <input
                    type="password"
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-lg py-3 px-4 text-center text-white focus:outline-none focus:border-blue-500 transition-colors tracking-widest text-lg"
                    autoFocus
                  />
                </div>

                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950/30 border border-red-900/40 text-red-400 text-xs font-mono"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg transition-all shadow-[0_0_15px_rgba(37,99,235,0.4)] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Key className="w-4 h-4" />
                      <span>KẾT NỐI SHELL</span>
                    </>
                  )}
                </button>
              </form>

              <p className="mt-6 text-[10px] text-center text-slate-600 uppercase tracking-wider font-mono">
                Các phiên đã xác thực được ghi nhật ký vào SQLite nội bộ
              </p>
            </div>
          </motion.div>
        ) : (
          // 2. Fully Loaded Interactive Web Terminal Sleek Dashboard
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col w-full h-screen overflow-hidden bg-[#0a0a0c]"
          >
            {/* Top Navigation Bar */}
            <header className="h-14 border-b border-white/10 bg-[#111116] flex items-center justify-between px-6 shrink-0 z-10">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-white/5 transition"
                >
                  <Menu className="w-4 h-4" />
                </button>
                <div className="w-3 h-3 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                <h1 className="text-xs sm:text-sm font-bold tracking-tight text-white uppercase flex items-center gap-2">
                  Terminal NodeShell 
                  <span className="text-slate-500 font-normal">v1.1.0</span>
                </h1>
              </div>

              <div className="flex items-center gap-4 sm:gap-8">
                <div className="hidden md:flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-[9px] uppercase text-slate-500 leading-none mb-1">Cơ sở dữ liệu</p>
                    <p className="text-xs font-mono text-blue-400 font-semibold uppercase">SQLite Đang Chạy</p>
                  </div>
                  <div className="h-8 w-[1px] bg-white/10"></div>
                  <div className="text-right">
                    <p className="text-[9px] uppercase text-slate-500 leading-none mb-1">Trạng thái kết nối</p>
                    <p className="text-xs font-mono text-emerald-400 font-semibold uppercase flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                      ĐÃ ĐỒNG BỘ
                    </p>
                  </div>
                </div>

                <button 
                  onClick={handleLogout}
                  className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-semibold rounded border border-red-500/30 transition-colors cursor-pointer"
                >
                  CHẤM DỨT PHIÊN
                </button>
              </div>
            </header>

            {/* Main Content Area */}
            <div className="flex flex-1 overflow-hidden">
              {/* COLLAPSIBLE SIDEBAR */}
              <AnimatePresence initial={false}>
                {isSidebarOpen && (
                  <motion.aside
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 280, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    className="bg-[#0d0d12] border-r border-white/10 flex flex-col h-full shrink-0 overflow-y-auto"
                  >
                    {/* System Resource Widgets */}
                    <div className="p-5 border-b border-white/10 space-y-5">
                      <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-widest">GIÁM SÁT HỆ THỐNG</h3>
                      
                      <div>
                        <div className="flex justify-between items-end mb-1.5">
                          <label className="text-[9px] uppercase font-bold text-slate-500">Tải CPU</label>
                          <span className="text-xs font-mono text-white">{cpuPercent}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${cpuPercent}%` }}></div>
                        </div>
                      </div>

                      <div>
                        <div className="flex justify-between items-end mb-1.5">
                          <label className="text-[9px] uppercase font-bold text-slate-500">Sử dụng Bộ nhớ</label>
                          <span className="text-xs font-mono text-white">{memUsedMB}MB / {memTotalMB}MB</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${memPercent}%` }}></div>
                        </div>
                      </div>
                    </div>

                    {/* Navigation Menu */}
                    <div className="p-4 border-b border-white/10">
                      <h3 className="text-[10px] uppercase font-bold text-slate-500 tracking-widest mb-3 px-2">DI CHUYỂN</h3>
                      <nav className="space-y-1">
                        <button
                          onClick={() => setActiveTab('terminal')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
                            activeTab === 'terminal' 
                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <TerminalIcon className="w-4 h-4" />
                          <span>Cửa Sổ Dòng Lệnh</span>
                        </button>

                        <button
                          onClick={() => {
                            setActiveTab('logs');
                            loadLogs();
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
                            activeTab === 'logs' 
                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <History className="w-4 h-4" />
                          <span>Nhật Ký Bảo Mật</span>
                        </button>

                        <button
                          onClick={() => {
                            setActiveTab('files');
                            loadFiles();
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
                            activeTab === 'files' 
                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <Folder className="w-4 h-4" />
                          <span>Quản Lý Tệp Tin</span>
                        </button>

                        <button
                          onClick={() => setActiveTab('settings')}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded text-xs font-semibold uppercase tracking-wider transition cursor-pointer ${
                            activeTab === 'settings' 
                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' 
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <Settings className="w-4 h-4" />
                          <span>Cấu Hình</span>
                        </button>
                      </nav>
                    </div>

                    {/* Interactive Logs in Sidebar */}
                    <div className="p-5 mt-auto">
                      <h3 className="text-[10px] uppercase font-bold text-slate-500 mb-3 tracking-widest">ĐĂNG NHẬP GẦN ĐÂY</h3>
                      <div className="space-y-3 font-mono text-[11px] leading-relaxed">
                        {logs.slice(0, 3).map((log, i) => (
                          <div key={i} className="border-b border-white/5 pb-2 last:border-0 last:pb-0">
                            <p className="text-slate-400 text-[10px]">{new Date(log.timestamp).toLocaleTimeString()}</p>
                            <p className="text-slate-500 truncate">
                              IP: <span className="text-blue-400">{log.ip}</span> • {log.event.includes('fail') ? <span className="text-red-400 font-bold">LỖI</span> : <span className="text-emerald-400 font-bold">OK</span>}
                            </p>
                          </div>
                        ))}
                        {logs.length === 0 && (
                          <p className="text-slate-600 italic">Chưa ghi nhận lượt kết nối nào.</p>
                        )}
                      </div>
                    </div>
                  </motion.aside>
                )}
              </AnimatePresence>

              {/* MAIN CONTENT INNER */}
              <main className="flex-1 flex flex-col overflow-hidden bg-black">
                {/* Dynamic Workspace Rendering */}
                <div className="flex-1 overflow-hidden relative">
                  <AnimatePresence mode="wait">
                    {/* TAB 1: Real-time Terminal Canvas */}
                    {activeTab === 'terminal' && (
                      <motion.div
                        key="terminal-tab"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="w-full h-full p-6 bg-black flex flex-col"
                      >
                        {/* Quick Commands & Info Header Bar */}
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-[#0d0d12] border border-white/10 border-b-0 rounded-t-lg px-4 py-3 gap-3 shrink-0">
                          <div className="flex items-center gap-2 font-mono text-xs text-white">
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            <span>Phiên dòng lệnh chuẩn (tty)</span>
                          </div>

                          {/* Quick Commands Selector */}
                          <div className="flex items-center gap-2 w-full sm:w-auto">
                            <span className="text-[10px] uppercase font-bold text-slate-500 font-mono whitespace-nowrap">Lệnh nhanh:</span>
                            <select
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val) {
                                  handleInsertCommand(val);
                                  e.target.value = ''; // Reset selection
                                }
                              }}
                              className="w-full sm:w-64 bg-black hover:bg-[#111116] border border-white/10 hover:border-white/20 text-xs font-mono text-slate-300 rounded px-2.5 py-1.5 focus:outline-none focus:border-blue-500 transition cursor-pointer"
                              defaultValue=""
                              id="select-quick-commands"
                            >
                              <option value="" disabled>-- Chọn lệnh nhanh --</option>
                              <optgroup label="Hệ Thống & Tài Nguyên" className="text-slate-400 bg-[#0d0d12]">
                                <option value="top" className="text-white">top (Giám sát quy trình)</option>
                                <option value="df -h" className="text-white">df -h (Xem dung lượng đĩa)</option>
                                <option value="free -m" className="text-white">free -m (Xem RAM trống)</option>
                                <option value="uname -a" className="text-white">uname -a (Thông tin kernel)</option>
                                <option value="uptime" className="text-white">uptime (Thời gian hoạt động)</option>
                              </optgroup>
                              <optgroup label="Tệp Tin & Thư Mục" className="text-slate-400 bg-[#0d0d12]">
                                <option value="ls -la" className="text-white">ls -la (Liệt kê tệp chi tiết)</option>
                                <option value="pwd" className="text-white">pwd (Đường dẫn hiện tại)</option>
                              </optgroup>
                              <optgroup label="Mạng & Kết Nối" className="text-slate-400 bg-[#0d0d12]">
                                <option value="ping -c 4 google.com" className="text-white">ping -c 4 google.com (Kiểm tra mạng)</option>
                                <option value="ifconfig" className="text-white">ifconfig (Cấu hình mạng)</option>
                                <option value="netstat -tuln" className="text-white">netstat -tuln (Cổng đang mở)</option>
                              </optgroup>
                              <optgroup label="Phát Triển & Quản Lý" className="text-slate-400 bg-[#0d0d12]">
                                <option value="node -v" className="text-white">node -v (Phiên bản Node.js)</option>
                                <option value="npm -v" className="text-white">npm -v (Phiên bản NPM)</option>
                                <option value="git status" className="text-white">git status (Trạng thái Git)</option>
                              </optgroup>
                            </select>
                          </div>
                        </div>

                        {/* Terminal wrapper */}
                        <div className="flex-1 rounded-b-lg bg-black border border-white/10 overflow-hidden relative p-4 shadow-2xl">
                          <div 
                            ref={terminalRef} 
                            className="w-full h-full [&_.xterm-viewport]:!overflow-y-auto" 
                          />
                        </div>
                        <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between text-[11px] text-slate-500 font-mono px-1 gap-2">
                          <span className="text-emerald-500/80 font-semibold">[HỆ THỐNG] Luồng Terminal đang hoạt động qua kết nối node-pty bảo mật</span>
                          <div className="flex items-center gap-3 flex-wrap">
                            <label className="flex items-center gap-1.5 select-none cursor-pointer text-slate-400 hover:text-slate-300 transition-colors" id="label-autoscroll">
                              <input
                                type="checkbox"
                                checked={autoScroll}
                                onChange={(e) => setAutoScroll(e.target.checked)}
                                className="w-3.5 h-3.5 rounded border-white/10 bg-[#111116] text-blue-500 focus:ring-0 focus:ring-offset-0 cursor-pointer accent-blue-500"
                                id="toggle-autoscroll"
                              />
                              <span>Tự động cuộn</span>
                            </label>
                            <span className="text-slate-700">|</span>
                            <button
                              onClick={exportTerminalHistory}
                              className="flex items-center gap-1.5 px-2 py-1 rounded bg-blue-600/10 text-blue-400 border border-blue-500/20 hover:bg-blue-600/20 hover:text-blue-300 cursor-pointer transition-colors"
                              title="Xuất lịch sử terminal"
                              id="btn-export-terminal"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Xuất log</span>
                            </button>
                            <button
                              onClick={clearTerminal}
                              className="flex items-center gap-1.5 px-2 py-1 rounded bg-rose-600/10 text-rose-400 border border-rose-500/20 hover:bg-rose-600/20 hover:text-rose-300 cursor-pointer transition-colors"
                              title="Xóa sạch màn hình terminal"
                              id="btn-clear-terminal"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Xóa màn hình</span>
                            </button>
                            <span className="text-slate-700">|</span>
                            <button 
                              onClick={() => setFontSize(prev => Math.max(10, prev - 1))}
                              className="p-1 rounded bg-[#111116] hover:bg-[#1c1c24] border border-white/10 cursor-pointer transition-colors"
                              title="Giảm cỡ chữ"
                              id="btn-decrease-font"
                            >
                              <Minus className="w-3 h-3 text-slate-400" />
                            </button>
                            <span>Cỡ chữ: {fontSize}px</span>
                            <button 
                              onClick={() => setFontSize(prev => Math.min(24, prev + 1))}
                              className="p-1 rounded bg-[#111116] hover:bg-[#1c1c24] border border-white/10 cursor-pointer transition-colors"
                              title="Tăng cỡ chữ"
                              id="btn-increase-font"
                            >
                              <Plus className="w-3 h-3 text-slate-400" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* TAB 2: Security Event Log history */}
                    {activeTab === 'logs' && (
                      <motion.div
                        key="logs-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="w-full h-full p-8 overflow-y-auto bg-[#0a0a0c]"
                      >
                        <div className="max-w-4xl mx-auto space-y-6">
                          <div className="flex items-center justify-between border-b border-white/10 pb-4">
                            <div>
                              <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-1">Nhật Ký Truy Cập & Kết Nối</h3>
                              <p className="text-xs text-slate-500 font-mono">Các sự kiện xác thực được giám sát trong SQLite</p>
                            </div>
                            <button
                              onClick={() => loadLogs()}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1a1a24] text-xs font-semibold text-slate-300 border border-white/10 rounded transition cursor-pointer"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>TẢI LẠI DB</span>
                            </button>
                          </div>

                          <div className="rounded-xl border border-white/10 bg-[#0d0d12]/60 overflow-hidden shadow-2xl">
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse text-sm">
                                <thead>
                                  <tr className="bg-[#111116]/80 border-b border-white/10 text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                                    <th className="py-3.5 px-5 font-semibold">Mô tả sự kiện</th>
                                    <th className="py-3.5 px-5 font-semibold">Địa chỉ IP</th>
                                    <th className="py-3.5 px-5 font-semibold">Thời gian</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/5 font-mono text-xs">
                                  {logs.length === 0 ? (
                                    <tr>
                                      <td colSpan={3} className="py-12 text-center text-slate-600 font-mono italic">
                                        Hiện tại chưa có nhật ký nào trong cơ sở dữ liệu SQLite.
                                      </td>
                                    </tr>
                                  ) : (
                                    logs.map((log, index) => (
                                      <tr key={index} className="hover:bg-white/[0.02] transition">
                                        <td className="py-3.5 px-5 text-slate-300">{log.event}</td>
                                        <td className="py-3.5 px-5 text-blue-400 font-semibold">{log.ip}</td>
                                        <td className="py-3.5 px-5 text-slate-500">
                                          {new Date(log.timestamp).toLocaleString()}
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}

                    {/* TAB 3: Admin Configurations & Security Settings */}
                    {activeTab === 'settings' && (
                      <motion.div
                        key="settings-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="w-full h-full p-8 overflow-y-auto bg-[#0a0a0c]"
                      >
                        <div className="max-w-3xl mx-auto space-y-8">
                          {/* Section 1: Terminal UI Styles */}
                          <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-6">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
                              <div>
                                <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">Tùy biến dòng lệnh</h3>
                                <p className="text-xs text-slate-500 font-mono">Chỉnh sửa các tùy chọn thiết lập được lưu vào cấu hình cục bộ</p>
                              </div>
                              <AnimatePresence>
                                {saveStatus !== 'idle' && (
                                  <motion.div
                                    initial={{ opacity: 0, x: 10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 10 }}
                                    className="flex items-center gap-1.5 text-xs font-mono select-none self-start sm:self-auto"
                                    id="settings-save-status"
                                  >
                                    {saveStatus === 'saving' && (
                                      <span className="flex items-center gap-1.5 text-blue-400">
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        <span>Đang tự động lưu...</span>
                                      </span>
                                    )}
                                    {saveStatus === 'saved' && (
                                      <span className="flex items-center gap-1.5 text-emerald-400">
                                        <Database className="w-3.5 h-3.5 animate-pulse" />
                                        <span>Đã lưu vào SQLite</span>
                                      </span>
                                    )}
                                    {saveStatus === 'error' && (
                                      <span className="flex items-center gap-1.5 text-rose-400">
                                        <AlertCircle className="w-3.5 h-3.5" />
                                        <span>Lỗi lưu cơ sở dữ liệu</span>
                                      </span>
                                    )}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              <div>
                                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">
                                  Thanh Chọn Cỡ Chữ
                                </label>
                                <div className="flex items-center gap-4">
                                  <input
                                    type="range"
                                    min="12"
                                    max="24"
                                    value={fontSize}
                                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                                    className="flex-1 accent-blue-500 cursor-pointer"
                                  />
                                  <span className="font-mono text-sm font-semibold bg-black px-3 py-1.5 rounded border border-white/10 w-12 text-center text-white">
                                    {fontSize}
                                  </span>
                                </div>
                              </div>

                              <div>
                                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-2">
                                  Chủ Đề Màu Sắc
                                </label>
                                <select
                                  value={activePreviewTheme}
                                  onChange={(e) => setPreviewTheme(e.target.value)}
                                  className="w-full py-2.5 px-3 bg-black border border-white/10 rounded text-sm text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                                >
                                  <option value="dark-classic">Mặc định Phiến đá (Tối cổ điển)</option>
                                  <option value="matrix">Xanh lục Ma trận (Cổ điển)</option>
                                  <option value="amber">Cam Hổ phách (CRT Phosphor)</option>
                                  <option value="cyberpunk">Neon Cyberpunk (Xanh & Hồng)</option>
                                </select>
                              </div>
                            </div>

                            {/* Live Theme Preview */}
                            <div className="border-t border-white/5 pt-6 space-y-4">
                              <div className="flex items-center justify-between">
                                <label className="block text-[10px] uppercase font-bold text-slate-500">
                                  Trực quan hóa Chủ đề (Live Preview)
                                </label>
                                {activePreviewTheme !== theme && (
                                  <span className="text-[10px] text-amber-400 font-mono italic animate-pulse">
                                    Chủ đề chưa được áp dụng
                                  </span>
                                )}
                              </div>
                              
                              <div 
                                style={{ 
                                  backgroundColor: getTerminalColors(activePreviewTheme).background, 
                                  color: getTerminalColors(activePreviewTheme).foreground 
                                }} 
                                className="rounded-lg p-5 font-mono text-xs border border-white/10 shadow-inner select-none flex flex-col justify-between transition-all duration-300 min-h-[160px]"
                                id="terminal-theme-preview"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 mb-3 pb-2 border-b border-white/5 opacity-50">
                                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/80"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80"></div>
                                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/80"></div>
                                    <span className="text-[9px] uppercase tracking-wider text-slate-400 ml-1">Cửa sổ xem trước</span>
                                  </div>
                                  <p className="flex items-center gap-1 flex-wrap">
                                    <span style={{ color: getTerminalColors(activePreviewTheme).cyan }}>visitor@nodeshell:~$</span>
                                    <span>cat welcome.txt</span>
                                  </p>
                                  <p style={{ color: getTerminalColors(activePreviewTheme).green }}>✔ VPS connected on secure tunnel.</p>
                                  <p className="flex items-center gap-1 flex-wrap">
                                    <span style={{ color: getTerminalColors(activePreviewTheme).cyan }}>visitor@nodeshell:~$</span>
                                    <span style={{ color: getTerminalColors(activePreviewTheme).yellow }}>node --version</span>
                                  </p>
                                  <p className="flex items-center">
                                    <span>v20.11.0</span>
                                    <span 
                                      style={{ backgroundColor: getTerminalColors(activePreviewTheme).cursor }} 
                                      className="inline-block w-2 h-4 ml-1.5 animate-pulse align-middle"
                                    />
                                  </p>
                                </div>
                                <div className="text-[9px] text-slate-500 text-right opacity-60 font-mono mt-4">
                                  Mã nền: {getTerminalColors(activePreviewTheme).background} | Mã chữ: {getTerminalColors(activePreviewTheme).foreground} | Mã con trỏ: {getTerminalColors(activePreviewTheme).cursor}
                                </div>
                              </div>

                              <div className="flex justify-end gap-3">
                                <button
                                  type="button"
                                  onClick={() => setPreviewTheme(null)}
                                  disabled={previewTheme === null}
                                  className="px-4 py-2 text-xs font-semibold rounded bg-[#111116] hover:bg-[#1a1a24] text-slate-400 hover:text-white border border-white/10 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
                                >
                                  Hoàn tác thay đổi
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTheme(activePreviewTheme);
                                    setPreviewTheme(null);
                                  }}
                                  disabled={activePreviewTheme === theme}
                                  className="px-4 py-2 text-xs font-semibold rounded bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/10 transition disabled:bg-emerald-600/20 disabled:text-emerald-400/80 disabled:shadow-none disabled:border disabled:border-emerald-500/10 cursor-pointer flex items-center gap-1.5"
                                  id="btn-apply-theme"
                                >
                                  {activePreviewTheme === theme ? (
                                    <>
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Chủ đề đang áp dụng</span>
                                    </>
                                  ) : (
                                    <span>Áp dụng chủ đề</span>
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Section 2: Password Management */}
                          <div className="p-6 rounded-xl border border-white/10 bg-[#111116]/40 space-y-6">
                            <div>
                              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1">Thay Đổi Khóa Truy Cập</h3>
                              <p className="text-xs text-slate-500 font-mono">Cập nhật mật khẩu chính để bảo vệ quyền truy cập Node-PTY</p>
                            </div>

                            <form onSubmit={handlePasswordChange} className="space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1.5 font-mono">Mật khẩu hiện tại</label>
                                  <input
                                    type="password"
                                    required
                                    value={currentPassword}
                                    onChange={(e) => setCurrentPassword(e.target.value)}
                                    className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1.5 font-mono">Mật khẩu mới</label>
                                  <input
                                    type="password"
                                    required
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-slate-400 mb-1.5 font-mono">Xác nhận mật khẩu</label>
                                  <input
                                    type="password"
                                    required
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500"
                                  />
                                </div>
                              </div>

                              {pwdError && (
                                <div className="flex items-start gap-2.5 p-3 rounded bg-red-950/30 border border-red-900/40 text-red-400 text-xs font-mono">
                                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                  <span>{pwdError}</span>
                                </div>
                              )}

                              {pwdSuccess && (
                                <div className="flex items-start gap-2.5 p-3 rounded bg-emerald-950/30 border border-emerald-900/40 text-emerald-400 text-xs font-mono">
                                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                                  <span>{pwdSuccess}</span>
                                </div>
                              )}

                              <div className="flex justify-end pt-2">
                                <button
                                  type="submit"
                                  disabled={loading}
                                  className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-5 rounded text-xs transition cursor-pointer disabled:opacity-50"
                                >
                                  {loading ? (
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    'CẬP NHẬT KHÓA CHÍNH'
                                  )}
                                </button>
                              </div>
                            </form>
                          </div>

                          {/* Floating Toast Notification */}
                          <AnimatePresence>
                            {saveStatus === 'saved' && (
                              <motion.div
                                initial={{ opacity: 0, y: 50, scale: 0.9 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 20, scale: 0.95 }}
                                className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-[#0d0d12] border border-emerald-500/30 text-slate-100 px-5 py-3.5 rounded-lg shadow-2xl shadow-black max-w-sm pointer-events-auto"
                                id="settings-save-toast"
                              >
                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                                  <Database className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">Đã lưu tự động</h4>
                                  <p className="text-[11px] text-slate-500 font-mono mt-0.5">Cấu hình giao diện đã đồng bộ thành công vào SQLite.</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSaveStatus('idle')}
                                  className="text-slate-500 hover:text-slate-300 transition-colors p-1 cursor-pointer"
                                  title="Đóng thông báo"
                                  id="btn-close-save-toast"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </motion.div>
                    )}

                    {/* TAB 4: File Manager */}
                    {activeTab === 'files' && (
                      <motion.div
                        key="files-tab"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="w-full h-full p-6 overflow-y-auto bg-[#0a0a0c]"
                      >
                        <div className="max-w-6xl mx-auto space-y-6">
                          {/* Top Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4 gap-4">
                            <div>
                              <h3 className="text-lg font-bold text-white uppercase tracking-wider mb-1">Quản Lý Tệp Tin</h3>
                              <p className="text-xs text-slate-500 font-mono">Duyệt, xem, tạo, sửa và xóa tệp tin trên hệ thống VPS</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={() => loadFiles(parentPath)}
                                disabled={!parentPath || currentPath === parentPath}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1a1a24] disabled:opacity-40 text-xs font-semibold text-slate-300 border border-white/10 rounded transition cursor-pointer"
                                title="Quay lại thư mục cha"
                              >
                                <ArrowUpLeft className="w-3.5 h-3.5" />
                                <span>Thư mục cha</span>
                              </button>
                              <button
                                onClick={() => loadFiles(currentPath)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1a1a24] text-xs font-semibold text-slate-300 border border-white/10 rounded transition cursor-pointer"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${fileLoading ? 'animate-spin' : ''}`} />
                                <span>Tải lại</span>
                              </button>
                              <button
                                onClick={() => { setShowCreateFolder(true); setShowCreateFile(false); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                              >
                                <FolderPlus className="w-3.5 h-3.5" />
                                <span>Thư mục mới</span>
                              </button>
                              <button
                                onClick={() => { setShowCreateFile(true); setShowCreateFolder(false); }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                              >
                                <FilePlus className="w-3.5 h-3.5" />
                                <span>Tệp tin mới</span>
                              </button>
                            </div>
                          </div>

                          {/* Error / Alert */}
                          {fileError && (
                            <div className="flex items-start gap-2.5 p-3 rounded bg-red-950/30 border border-red-900/40 text-red-400 text-xs font-mono">
                              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              <span>{fileError}</span>
                              <button onClick={() => setFileError(null)} className="ml-auto text-red-400 hover:text-white font-bold">X</button>
                            </div>
                          )}

                          {/* Create Folder Inline Form */}
                          {showCreateFolder && (
                            <div className="p-4 rounded-lg bg-[#111116] border border-blue-500/30 flex flex-col sm:flex-row gap-3 items-end sm:items-center">
                              <div className="flex-1">
                                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5 font-mono">Tên thư mục mới</label>
                                <input
                                  type="text"
                                  value={newDirName}
                                  onChange={(e) => setNewDirName(e.target.value)}
                                  placeholder="Nhập tên thư mục..."
                                  className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={createNewDir}
                                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                                >
                                  Tạo thư mục
                                </button>
                                <button
                                  onClick={() => setShowCreateFolder(false)}
                                  className="px-4 py-2 bg-[#1c1c24] hover:bg-[#252530] text-xs font-semibold text-slate-400 rounded transition cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Create File Inline Form */}
                          {showCreateFile && (
                            <div className="p-4 rounded-lg bg-[#111116] border border-purple-500/30 flex flex-col sm:flex-row gap-3 items-end sm:items-center">
                              <div className="flex-1">
                                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5 font-mono">Tên tệp tin mới</label>
                                <input
                                  type="text"
                                  value={newFileName}
                                  onChange={(e) => setNewFileName(e.target.value)}
                                  placeholder="Nhập tên tệp (ví dụ: script.sh, notes.txt)..."
                                  className="w-full px-3 py-2 bg-black border border-white/10 rounded text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={createNewFile}
                                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                                >
                                  Tạo tệp
                                </button>
                                <button
                                  onClick={() => setShowCreateFile(false)}
                                  className="px-4 py-2 bg-[#1c1c24] hover:bg-[#252530] text-xs font-semibold text-slate-400 rounded transition cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Breadcrumb & Search Bar */}
                          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
                            {/* Breadcrumb Path Bar */}
                            <div className="flex-1 flex items-center gap-2 px-4 py-2.5 bg-[#0d0d12] border border-white/10 rounded-lg text-xs font-mono text-slate-400 min-w-0">
                              <span className="text-slate-500 uppercase tracking-widest shrink-0">Đường dẫn:</span>
                              <span className="text-white bg-white/5 px-2 py-0.5 rounded select-all break-all truncate" title={currentPath || '/'}>{currentPath || '/'}</span>
                            </div>

                            {/* Search Input Bar */}
                            {!viewingFile && (
                              <div className="relative w-full md:w-80 shrink-0">
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                  <Search className="h-4 w-4 text-slate-500" />
                                </span>
                                <input
                                  type="text"
                                  value={fileSearchQuery}
                                  onChange={(e) => setFileSearchQuery(e.target.value)}
                                  placeholder="Tìm kiếm tệp, thư mục..."
                                  className="w-full pl-9 pr-8 py-2.5 bg-[#0d0d12] border border-white/10 rounded-lg text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                                />
                                {fileSearchQuery && (
                                  <button
                                    onClick={() => setFileSearchQuery('')}
                                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-500 hover:text-white cursor-pointer"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Conditional View: File Editor OR Directory List */}
                          {viewingFile ? (
                            <div className="rounded-xl border border-white/10 bg-[#0d0d12]/60 overflow-hidden shadow-2xl flex flex-col">
                              {/* Editor Header */}
                              <div className="bg-[#111116]/80 px-5 py-3.5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex items-center gap-2 font-mono">
                                  {getFileIcon(viewingFile)}
                                  <span className="text-xs text-white truncate max-w-md" title={viewingFile}>
                                    {viewingFile.replace(/\\/g, '/').split('/').pop()}
                                  </span>
                                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                    {isEditingFile ? 'Đang chỉnh sửa' : 'Chỉ xem'}
                                  </span>
                                </div>
                                <div className="flex gap-2">
                                  {isEditingFile ? (
                                    <>
                                      <button
                                        onClick={saveEditedFile}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                                      >
                                        <Save className="w-3.5 h-3.5" />
                                        <span>Lưu tệp</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setIsEditingFile(false);
                                          openFile(viewingFile);
                                        }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1c1c24] hover:bg-[#252530] text-xs font-semibold text-slate-300 rounded border border-white/10 transition cursor-pointer"
                                      >
                                        <span>Hủy</span>
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => setIsEditingFile(true)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white rounded transition cursor-pointer"
                                    >
                                      <Edit className="w-3.5 h-3.5" />
                                      <span>Chỉnh sửa</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => { setViewingFile(null); setFileContent(null); }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111116] hover:bg-[#1c1c24] text-xs font-semibold text-slate-400 border border-white/10 rounded transition cursor-pointer"
                                  >
                                    <ArrowLeft className="w-3.5 h-3.5" />
                                    <span>Đóng</span>
                                  </button>
                                </div>
                              </div>

                              {/* Editor Content */}
                              <div className="p-4 bg-black">
                                <textarea
                                  value={fileContent || ''}
                                  onChange={(e) => setFileContent(e.target.value)}
                                  readOnly={!isEditingFile}
                                  className="w-full h-96 bg-black text-slate-300 font-mono text-xs focus:outline-none resize-y p-3 rounded border border-white/5 focus:border-white/20 select-all leading-relaxed"
                                  spellCheck={false}
                                  placeholder="Nội dung tệp rỗng..."
                                />
                              </div>
                            </div>
                          ) : (
                            /* Directory List */
                            <div className="rounded-xl border border-white/10 bg-[#0d0d12]/60 overflow-hidden shadow-2xl">
                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-sm">
                                  <thead>
                                    <tr className="bg-[#111116]/80 border-b border-white/10 text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                                      <th className="py-3.5 px-5 font-semibold">Tên</th>
                                      <th className="py-3.5 px-5 font-semibold hidden sm:table-cell">Kích thước</th>
                                      <th className="py-3.5 px-5 font-semibold hidden md:table-cell">Lần cuối sửa</th>
                                      <th className="py-3.5 px-5 font-semibold text-right">Thao tác</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/5 font-mono text-xs">
                                    {filteredFiles.length === 0 ? (
                                      <tr>
                                        <td colSpan={4} className="py-12 text-center text-slate-600 font-mono italic">
                                          {fileSearchQuery ? 'Không tìm thấy tệp hoặc thư mục phù hợp.' : 'Thư mục này trống hoặc không có quyền truy cập.'}
                                        </td>
                                      </tr>
                                    ) : (
                                      filteredFiles.map((file, index) => {
                                        const fullItemPath = currentPath + (currentPath.endsWith('/') || currentPath.endsWith('\\') ? '' : '/') + file.name;
                                        return (
                                          <tr key={index} className="hover:bg-white/[0.02] transition-colors group">
                                            {/* File / Folder Name Clickable */}
                                            <td className="py-3.5 px-5">
                                              {file.isDirectory ? (
                                                <button
                                                  onClick={() => loadFiles(fullItemPath)}
                                                  className="flex items-center gap-2.5 text-blue-400 hover:text-blue-300 font-semibold cursor-pointer text-left"
                                                >
                                                  <Folder className="w-4 h-4 shrink-0 text-blue-500" />
                                                  <span className="truncate max-w-xs sm:max-w-md">{file.name}/</span>
                                                </button>
                                              ) : (
                                                <button
                                                  onClick={() => openFile(fullItemPath)}
                                                  className="flex items-center gap-2.5 text-slate-300 hover:text-white cursor-pointer text-left"
                                                >
                                                  {getFileIcon(file.name)}
                                                  <span className="truncate max-w-xs sm:max-w-md">{file.name}</span>
                                                </button>
                                              )}
                                            </td>

                                            {/* Size */}
                                            <td className="py-3.5 px-5 text-slate-400 hidden sm:table-cell">
                                              {file.isDirectory ? (
                                                <span className="text-[10px] text-slate-600 uppercase">Thư mục</span>
                                              ) : (
                                                <span>
                                                  {file.size < 1024
                                                    ? `${file.size} B`
                                                    : file.size < 1024 * 1024
                                                    ? `${(file.size / 1024).toFixed(1)} KB`
                                                    : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
                                                </span>
                                              )}
                                            </td>

                                            {/* Mtime */}
                                            <td className="py-3.5 px-5 text-slate-500 hidden md:table-cell">
                                              {new Date(file.mtime).toLocaleString()}
                                            </td>

                                            {/* Actions */}
                                            <td className="py-2.5 px-5 text-right">
                                              <div className="flex items-center justify-end gap-1.5">
                                                {file.isDirectory ? (
                                                  <button
                                                    onClick={() => loadFiles(fullItemPath)}
                                                    className="p-1.5 rounded bg-blue-500/5 hover:bg-blue-500/20 text-blue-400 border border-blue-500/10 cursor-pointer transition-colors"
                                                    title="Mở thư mục"
                                                  >
                                                    <ChevronRight className="w-3.5 h-3.5" />
                                                  </button>
                                                ) : (
                                                  <>
                                                    <button
                                                      onClick={() => openFile(fullItemPath)}
                                                      className="p-1.5 rounded bg-purple-500/5 hover:bg-purple-500/20 text-purple-400 border border-purple-500/10 cursor-pointer transition-colors"
                                                      title="Xem tệp"
                                                    >
                                                      <Eye className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                      onClick={() => {
                                                        openFile(fullItemPath).then(() => {
                                                          setIsEditingFile(true);
                                                        });
                                                      }}
                                                      className="p-1.5 rounded bg-blue-500/5 hover:bg-blue-500/20 text-blue-400 border border-blue-500/10 cursor-pointer transition-colors"
                                                      title="Sửa tệp"
                                                    >
                                                      <Edit className="w-3.5 h-3.5" />
                                                    </button>
                                                  </>
                                                )}
                                                <button
                                                  onClick={() => deleteFileOrFolder(fullItemPath)}
                                                  className="p-1.5 rounded bg-red-500/5 hover:bg-red-500/20 text-red-400 border border-red-500/10 cursor-pointer transition-colors"
                                                  title="Xóa"
                                                >
                                                  <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </main>
            </div>

            {/* Footer Status Bar */}
            <footer className="h-8 bg-[#111116] border-t border-white/10 flex items-center justify-between px-6 shrink-0 text-[10px] font-mono text-slate-500 uppercase tracking-widest z-10 select-none">
              <div className="flex gap-6">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                  Socket.io: Sẵn sàng
                </span>
                <span className="hidden sm:inline">Bộ nhớ đệm: 1024kb</span>
                <span className="hidden md:inline text-slate-400">Node-PTY: Hoạt động</span>
              </div>
              <div className="flex gap-6">
                <span>Cổng: 3000</span>
                <span className="hidden sm:inline">Máy chủ: 127.0.0.1</span>
                <span className="text-slate-400">UTF-8</span>
              </div>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
