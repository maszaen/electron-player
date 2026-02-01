const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    minimize: () => ipcRenderer.invoke('window-minimize'),
    maximize: () => ipcRenderer.invoke('window-maximize'),
    close: () => ipcRenderer.invoke('window-close'),
    refresh: () => ipcRenderer.invoke('window-refresh'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
    
    // Listen for maximize state changes
    onMaximizeChange: (callback) => {
        ipcRenderer.on('window-maximized', (event, isMaximized) => callback(isMaximized));
    },
    
    scanDefault: () => ipcRenderer.invoke('scan-directory'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
});
