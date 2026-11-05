import { selectOcrTextForTts } from "../../apps/web/src/features/video-workflow/ocr-text-for-tts";

const lines = selectOcrTextForTts([
  { text: "Nguyễn Việt Hùng" },
  { text: "Theo dõi" },
  { text: "Tôi ở đại học, dạy sinh viên có đầu vào" },
  { text: "mà cứ thấy cân cân mấy năm rồi" },
  { text: "5 giờ Thích Trả lời" },
]);

const text = lines.map((line) => line.text).join("\n");
if (text !== "Tôi ở đại học, dạy sinh viên có đầu vào\nmà cứ thấy cân cân mấy năm rồi") {
  throw new Error(`Expected only comment text for TTS, got: ${text}`);
}

console.log("smoke:video-ocr-text-for-tts ok");
