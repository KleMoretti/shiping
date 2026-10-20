import { ipcMain } from 'electron'
import { detectSystemProxy, testProxyConnection } from './proxy'

ipcMain.handle('proxy:detect', (_event, baseURL: string) => detectSystemProxy(baseURL))
ipcMain.handle('proxy:test', (_event, proxy, profile) => testProxyConnection(proxy, profile))
