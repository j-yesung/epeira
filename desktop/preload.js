// 화면(renderer)에 노출하는 최소 API — Node 는 화면에 직접 열지 않는다
const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('orbit', {
  projects: () => ipcRenderer.invoke('projects:list'),
  addProject: () => ipcRenderer.invoke('projects:add'),
  removeProject: dir => ipcRenderer.invoke('projects:remove', dir),
  touchProject: dir => ipcRenderer.invoke('projects:touch', dir),
  collector: () => ipcRenderer.invoke('collector:ensure'),
  usage: refresh => ipcRenderer.invoke('collector:usage', !!refresh),
  createTerm: opts => ipcRenderer.invoke('pty:create', opts),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: id => ipcRenderer.send('pty:kill', id),
  onData: fn => ipcRenderer.on('pty:data', (_, id, data) => fn(id, data)),
  onExit: fn => ipcRenderer.on('pty:exit', (_, id, code) => fn(id, code)),
  onMenu: fn => ipcRenderer.on('menu', (_, action) => fn(action)),
  openExternal: url => ipcRenderer.send('open-external', url),
  platform: process.platform,
  orbitUrl: (process.argv.find(a => a.startsWith('--agent-orbit-url=')) || '=http://127.0.0.1:47777').split('=')[1],
});
