import {
  groupOcrWords,
  hasRecognizedDialogue,
  selectBestOcrDialogueCandidate,
} from '../../apps/server/src/modules/video/ocr-dialogue';

const lines = groupOcrWords(
  [
    { text: 'Tin nhắn A', confidence: 96, bbox: { x0: 80, y0: 40, x1: 220, y1: 72 } },
    { text: 'Tin nhắn B', confidence: 91, bbox: { x0: 820, y0: 160, x1: 980, y1: 192 } },
  ],
  1080,
  1920,
);

if (lines.length !== 2 || lines[0]?.speaker !== 'A' || lines[1]?.speaker !== 'B') {
  throw new Error('OCR dialogue smoke failed: order or left/right speaker mapping is wrong.');
}
if (!hasRecognizedDialogue(lines)) {
  throw new Error('OCR dialogue smoke failed: A/B messages should be eligible for dialogue mode.');
}
if (hasRecognizedDialogue(lines.slice(0, 1))) {
  throw new Error('OCR dialogue smoke failed: one speaker must not be eligible for dialogue mode.');
}

const numericDialogue = groupOcrWords(
  [
    { text: 'Ctay', confidence: 95, bbox: { x0: 80, y0: 40, x1: 150, y1: 72 } },
    { text: '2', confidence: 97, bbox: { x0: 158, y0: 40, x1: 172, y1: 72 } },
    { text: 'tháng', confidence: 96, bbox: { x0: 180, y0: 40, x1: 260, y1: 72 } },
    { text: 'rồi', confidence: 96, bbox: { x0: 268, y0: 40, x1: 318, y1: 72 } },
  ],
  1080,
  1920,
);
if (numericDialogue[0]?.text !== 'Ctay 2 tháng rồi') {
  throw new Error('OCR dialogue smoke failed: standalone numbers inside a message were removed.');
}

const bestCandidate = selectBestOcrDialogueCandidate([
  [{ ...numericDialogue[0]!, text: 'Ctay tháng rồi' }],
  numericDialogue,
]);
if (bestCandidate[0]?.text !== 'Ctay 2 tháng rồi') {
  throw new Error('OCR dialogue smoke failed: the more complete OCR pass was not selected.');
}

const thresholdDialogue = groupOcrWords(
  [
    { text: 'a', confidence: 96, bbox: { x0: 267, y0: 194, x1: 298, y1: 258 } },
    { text: 'mới', confidence: 96, bbox: { x0: 319, y0: 194, x1: 419, y1: 258 } },
    { text: 'dậy', confidence: 96, bbox: { x0: 441, y0: 194, x1: 545, y1: 258 } },
    { text: 'Em', confidence: 93, bbox: { x0: 986, y0: 696, x1: 1070, y1: 747 } },
    { text: 'k', confidence: 93, bbox: { x0: 1093, y0: 696, x1: 1123, y1: 747 } },
    { text: 'thích', confidence: 93, bbox: { x0: 1142, y0: 696, x1: 1283, y1: 747 } },
    { text: 'matcha', confidence: 92, bbox: { x0: 1307, y0: 696, x1: 1519, y1: 747 } },
  ],
  1600,
  862,
);
if (!hasRecognizedDialogue(thresholdDialogue)) {
  throw new Error('OCR dialogue smoke failed: threshold pass did not retain the right-side message.');
}
if (selectBestOcrDialogueCandidate([lines, thresholdDialogue])[1]?.text !== 'Em k thích matcha') {
  throw new Error('OCR dialogue smoke failed: threshold dialogue candidate was not selected.');
}

const wrappedLines = groupOcrWords(
  [
    { text: '& Muon roi con dat do an nua ha con', confidence: 93, bbox: { x0: 22, y0: 258, x1: 497, y1: 303 } },
    { text: 'da con dat ga ran, dem tu nhien doi bung a', confidence: 96, bbox: { x0: 185, y0: 368, x1: 688, y1: 394 } },
    { text: 'ba', confidence: 97, bbox: { x0: 185, y0: 399, x1: 211, y1: 420 } },
    { text: '3 Ngon thi tra tien voi cam on nguoi ta la duoc', confidence: 91, bbox: { x0: 22, y0: 975, x1: 609, y1: 1025 } },
    { text: 'roi', confidence: 96, bbox: { x0: 95, y0: 1031, x1: 121, y1: 1051 } },
  ],
  738,
  1600,
);

if (wrappedLines.length !== 3) {
  throw new Error(`OCR dialogue smoke failed: wrapped lines were not merged (${wrappedLines.length}).`);
}
if (wrappedLines[0]?.text !== 'Muon roi con dat do an nua ha con') {
  throw new Error('OCR dialogue smoke failed: leading OCR noise was not removed.');
}
if (wrappedLines[1]?.speaker !== 'B' || !wrappedLines[1].text.endsWith(' a ba')) {
  throw new Error('OCR dialogue smoke failed: wrapped reply did not inherit speaker B.');
}
if (wrappedLines[2]?.text !== 'Ngon thi tra tien voi cam on nguoi ta la duoc roi') {
  throw new Error('OCR dialogue smoke failed: wrapped sender message was not reconstructed.');
}

console.log('video-ocr-dialogue smoke passed');
