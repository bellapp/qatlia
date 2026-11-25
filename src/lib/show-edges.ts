/**
 * Whether the plan shows and prints the chants (owner request, 2026-11-25).
 * A choice of the device, on by default; it changes the drawing only, never
 * the plan nor its price. Private windows and blocked storage read as on.
 */

const KEY = 'qatlia_show_edges';

export function readShowEdges(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveShowEdges(show: boolean): void {
  try {
    localStorage.setItem(KEY, show ? '1' : '0');
  } catch {
    // Not kept for next time; the screen still follows the switch.
  }
}
