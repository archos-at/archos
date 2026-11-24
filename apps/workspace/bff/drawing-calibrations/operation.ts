export const CALIBRATION_SET_OPERATION = 'drawing-calibration-set'

export const isCalibrationProposal = (operation: string): boolean =>
  operation === CALIBRATION_SET_OPERATION
