import {
  desktopCapturer,
  ipcMain,
  screen,
  type DesktopCapturerSource,
  type Display,
  type NativeImage
} from 'electron'
import { regionToPixels, type RegionRect } from '../shared/capture-region'
import { settings } from './settings'

/** A connected screen, as offered by the capture-screen picker in settings */
export interface DisplayOption {
  /** `Display.id` as a string, the value stored in `settings.captureScreen` */
  id: string
  /** Name the OS gives the monitor, e.g. `DELL U2720Q`; may be blank */
  label: string
  primary: boolean
  /** The resolution the OS display settings show, so the user can tell screens apart */
  width: number
  height: number
}

/**
 * Windows settings show physical pixels, macOS the "looks like" size, which is
 * the DIP size: a 4K panel at 2x is listed as 2560×1440, not 5120×2880.
 */
export function settingsResolution(display: Display): Electron.Size {
  const scale = process.platform === 'darwin' ? 1 : display.scaleFactor
  return {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale)
  }
}

/**
 * The capture source of a screen. Sources come in no particular order, so
 * `sources[0]` is not the primary screen; `display_id` matches `Display.id`
 * on macOS and Windows.
 */
export function findScreenSource(
  sources: DesktopCapturerSource[],
  display: Display
): DesktopCapturerSource | undefined {
  return sources.find((s) => s.display_id === String(display.id))
}

/**
 * Capture every screen, `displays` being the ones the caller needs. The first
 * capture after launch now and then comes back empty for one screen (seen on
 * macOS with an external one) while the next is fine, so a needed screen that
 * comes back empty is captured once more.
 */
export async function captureScreens(
  thumbnailSize: Electron.Size,
  displays: Display[]
): Promise<DesktopCapturerSource[]> {
  const capture = (): Promise<DesktopCapturerSource[]> =>
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
  const sources = await capture()
  const hasEmpty = displays.some((d) => findScreenSource(sources, d)?.thumbnail.isEmpty())
  return hasEmpty ? capture() : sources
}

/**
 * What to capture. A region pins the capture to its own screen; otherwise it
 * is the screen fixed in settings, or the one under the cursor. A chosen
 * screen that is no longer connected is passed over, keeping the choice for
 * when it is plugged back in.
 */
function getCaptureTarget(): { display: Display; region: RegionRect | null } {
  const displays = screen.getAllDisplays()
  const byId = (id: string): Display | undefined => displays.find((d) => String(d.id) === id)

  const region = settings.captureRegion
  const regionDisplay = region && byId(region.displayId)
  if (regionDisplay) return { display: regionDisplay, region }

  const display =
    byId(settings.captureScreen) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return { display, region: null }
}

export function takeScreenshot(): Promise<string | void> {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve()

  const { display, region } = getCaptureTarget()
  const { width, height } = display.size

  return captureScreens({ width, height }, [display])
    .then((sources) => {
      if (sources.length === 0) return undefined
      const { thumbnail } = findScreenSource(sources, display) ?? sources[0]
      const image = region ? thumbnail.crop(regionToPixels(region, thumbnail.getSize())) : thumbnail
      return image.toPNG().toString('base64')
    })
    .catch((error) => {
      console.error('Error taking screenshot:', error)
    })
}

/**
 * An area of a capture of `display`, taken at whatever resolution, as the
 * screenshot takeScreenshot() would make of it: sized in DIPs, not physical
 * pixels, so it costs the model what the same area of a full capture would.
 */
export function cropScreenshot(capture: NativeImage, display: Display, area: RegionRect): string {
  const { width, height } = regionToPixels(area, display.size)
  return capture
    .crop(regionToPixels(area, capture.getSize()))
    .resize({ width, height, quality: 'best' })
    .toPNG()
    .toString('base64')
}

/** Connected screens, numbered left to right so the list matches the desk */
function listDisplays(): DisplayOption[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen
    .getAllDisplays()
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
    .map((d) => ({
      id: String(d.id),
      label: d.label,
      primary: d.id === primaryId,
      ...settingsResolution(d)
    }))
}

ipcMain.handle('getDisplays', () => listDisplays())
