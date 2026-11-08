export const PIN_LENGTH = 4;

/** Rejects PINs anyone could guess: one repeated digit, or a straight run like 123456. */
export function isWeakPin(pin: string) {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  // Same rule the API applies, so the user hears about it before the request.
  const steps = digits.slice(1).map((digit, index) => digit - digits[index]);
  return steps.every((step) => step === 1) || steps.every((step) => step === -1);
}
