import { formatStructuredPreviewText } from "../../apps/web/src/lib/structured-preview-text";

const numberedInput =
  "Đúc kết đc xíu này và mình cũng làm như vậy 1. Kiềm chế ham muốn phản bác 2. Với người lạ chỉ nói 30%, người quen chỉ nói 50%, người nhà nói 70% 3. Lương 10 triệu thì nói với họ hàng là 3 triệu, với bạn bè là 5 triệu, với người yêu là 8 triệu, còn với đồng nghiệp thì bảo: \"Cũng như nhau thôi\"";
const numberedExpected = [
  "Đúc kết đc xíu này và mình cũng làm như vậy",
  "1. Kiềm chế ham muốn phản bác",
  "2. Với người lạ chỉ nói 30%, người quen chỉ nói 50%, người nhà nói 70%",
  "3. Lương 10 triệu thì nói với họ hàng là 3 triệu, với bạn bè là 5 triệu, với người yêu là 8 triệu, còn với đồng nghiệp thì bảo: \"Cũng như nhau thôi\"",
].join("\n");

if (formatStructuredPreviewText(numberedInput) !== numberedExpected) {
  throw new Error("Expected numbered preview text to split into separate lines.");
}

const paragraphInput =
  "Cách để nhận biết một người đáng tiếp xúc hay không là hãy quan sát cách họ phản hồi sau khi mình làm cho họ điều gì đó miễn phí. Chẳng hạn, mình mời người ta cốc nước. Người ta ngại, khó xử khi nhận, rồi tìm cách mời lại mình, thì người đó đáng để tiếp xúc lâu dài.";
const paragraphExpected = [
  "Cách để nhận biết một người đáng tiếp xúc hay không là hãy quan sát cách họ phản hồi sau khi mình làm cho họ điều gì đó miễn phí.",
  "",
  "Chẳng hạn, mình mời người ta cốc nước. Người ta ngại, khó xử khi nhận, rồi tìm cách mời lại mình, thì người đó đáng để tiếp xúc lâu dài.",
].join("\n");

if (formatStructuredPreviewText(paragraphInput) !== paragraphExpected) {
  throw new Error("Expected paragraph starter preview text to split into a new paragraph.");
}

const plainInput = "Một comment bình thường chỉ có một đoạn ngắn.";
if (formatStructuredPreviewText(plainInput) !== plainInput) {
  throw new Error("Expected plain preview text to stay unchanged.");
}

console.log("smoke:preview-text-formatting ok");
