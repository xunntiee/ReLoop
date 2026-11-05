import { prepareNarrationText } from "../../apps/server/src/modules/video/tts-text-preprocessor";

const baseConfig = {
  openAiApiKey: "",
  openAiBaseUrl: "https://example.invalid",
  openAiModel: "demo",
} as const;

const first = await prepareNarrationText({
  config: baseConfig as never,
  kind: "comment",
  mode: "rules_only",
  text: "hên k phải idol mình r chừng nào đi World Cup v",
});

if (!first.finalText.toLowerCase().includes("không phải")) {
  throw new Error(`Expected "k phải" -> "không phải", got: ${first.finalText}`);
}

if (!first.finalText.toLowerCase().includes("rồi chừng nào")) {
  throw new Error(`Expected "r chừng nào" -> "rồi chừng nào", got: ${first.finalText}`);
}

if (!first.finalText.toLowerCase().includes("vậy")) {
  throw new Error(`Expected trailing "v" -> "vậy", got: ${first.finalText}`);
}

const second = await prepareNarrationText({
  config: baseConfig as never,
  kind: "comment",
  mode: "rules_only",
  text: "t m b ko dc rep ib",
});

const normalizedSecond = second.finalText.toLowerCase();
for (const expected of ["tao", "mày", "bạn", "không", "được", "trả lời", "nhắn tin"]) {
  if (!normalizedSecond.includes(expected)) {
    throw new Error(`Expected "${expected}" inside: ${second.finalText}`);
  }
}

const third = await prepareNarrationText({
  config: baseConfig as never,
  kind: "comment",
  mode: "rules_only",
  text: "Bthg đi cafe tối hoặc được tặng tầm 10h là k dám ùn tới tại mất",
});

const normalizedThird = third.finalText.toLowerCase();
for (const expected of ["bình thường", "cà phê", "không"]) {
  if (!normalizedThird.includes(expected)) {
    throw new Error(`Expected "${expected}" inside: ${third.finalText}`);
  }
}

for (const rejected of ["bthg", "cafe"]) {
  if (normalizedThird.includes(rejected)) {
    throw new Error(`Expected shorthand "${rejected}" to be expanded, got: ${third.finalText}`);
  }
}

const fourth = await prepareNarrationText({
  config: baseConfig as never,
  kind: "comment",
  mode: "rules_only",
  text: "Nói lái đạo vẫn nợ từ xưa rồi :)) cụ nào nghĩ ra tên hai cái con này đúng thâm:) =)) =)",
});

if (!fourth.finalText.includes("Nói lái đạo vẫn nợ từ xưa rồi")) {
  throw new Error(`Expected Vietnamese accents to be preserved, got: ${fourth.finalText}`);
}

if (
  [":)", ":))", "=)", "=))", "phẩy"].some((emoticon) =>
    fourth.finalText.includes(emoticon),
  )
) {
  throw new Error(`Expected emoticons to be removed for TTS, got: ${fourth.finalText}`);
}

const offMode = await prepareNarrationText({
  config: baseConfig as never,
  kind: "comment",
  mode: "off",
  text: "Đây nx nè =) :) :)) =))",
});

if ([":)", ":))", "=)", "=))"].some((emoticon) => offMode.finalText.includes(emoticon))) {
  throw new Error(`Expected emoticons to be removed even when processing is off, got: ${offMode.finalText}`);
}

const originalFetch = globalThis.fetch;
let mockLlmFinalText =
  "Noi lai dao van no tu xua roi, cu nao nghi ra ten hai cai con nay dung tham";
globalThis.fetch = (async () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              finalText: mockLlmFinalText,
            }),
          },
        },
      ],
    }),
    {
      headers: { "Content-Type": "application/json" },
      status: 200,
    },
  )) as typeof fetch;

try {
  const fifth = await prepareNarrationText({
    config: {
      ...baseConfig,
      openAiApiKey: "test-key",
    } as never,
    kind: "comment",
    mode: "llm_assist",
    text: "Nói lái đạo vẫn nợ từ xưa rồi :)) cụ nào nghĩ ra tên hai cái con này đúng thâm:)",
  });

  if (fifth.finalText.includes("Noi lai dao")) {
    throw new Error(`Expected unaccented LLM output to be rejected, got: ${fifth.finalText}`);
  }

  if (!fifth.finalText.includes("Nói lái đạo")) {
    throw new Error(`Expected conservative accented fallback, got: ${fifth.finalText}`);
  }

  if (!fifth.warnings.some((warning) => warning.includes("Vietnamese accents"))) {
    throw new Error(`Expected accent-loss warning, got: ${fifth.warnings.join("; ")}`);
  }

  mockLlmFinalText = "Câu thứ nhất phẩy câu thứ hai";
  const sixth = await prepareNarrationText({
    config: {
      ...baseConfig,
      openAiApiKey: "test-key",
    } as never,
    kind: "comment",
    mode: "llm_assist",
    text: "Câu thứ nhất câu thứ hai",
  });

  if (sixth.finalText !== "Câu thứ nhất, câu thứ hai") {
    throw new Error(`Expected an AI-spelled comma to be restored, got: ${sixth.finalText}`);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log("smoke:video-tts-shorthand ok");
