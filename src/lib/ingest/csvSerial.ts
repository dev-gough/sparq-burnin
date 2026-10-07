import * as path from 'path'

/**
 * Spreadsheet exports can round serials into scientific notation. Expanding
 * that value loses the original digits, so recover them from the result
 * filename only when they round to the same value at the CSV's precision.
 * Ordinary serial strings retain the existing CSV behavior.
 */
export function resolveCsvSerial(
  rawSerial: string | undefined,
  resultsFile: string,
  warn: (message: string) => void = () => {},
): string {
  const serial = (rawSerial ?? '').trim()
  const scientific = /^([1-9])(?:\.(\d+))?[eE]\+?(\d+)$/.exec(serial)
  if (!scientific) return serial

  const filename = path.basename(resultsFile)
  const filenameSerial = /^(\d+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(?:-\d{2})?\.csv$/.exec(filename)?.[1]
  const value = Number(filenameSerial)
  const precision = scientific[2]?.length ?? 0
  if (
    !filenameSerial || !Number.isSafeInteger(value) || value <= 0 ||
    precision > 15 || Number(value.toExponential(precision)) !== Number(serial)
  ) {
    throw new Error(`Cannot safely recover scientific-notation serial ${serial} from ${filename}`)
  }

  warn(`Recovered serial ${filenameSerial} from ${filename}; CSV contains rounded value ${serial}`)
  return filenameSerial
}
