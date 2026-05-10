import { PageSpec, SeriesSpec } from "../types";

const DEFAULT_NEGATIVE_PROMPT =
  "subtitles, captions, on-screen text, speech bubbles, watermark, logo, UI overlay, credits, letterboxing text, distorted face, extra fingers";

const normalizeLine = (value: string): string => {
  return String(value || "").replace(/\s+/g, " ").trim();
};

const resolveDefaultSpeaker = (series: SeriesSpec): string => {
  const cast = Array.isArray(series.anchors.cast) ? series.anchors.cast : [];
  const protagonist = cast.find((c) => c?.role === "protagonist");
  const castName = normalizeLine(String(protagonist?.name || ""));
  if (castName) return castName;
  return "주인공";
};

const resolveToneByMood = (mood: string): string => {
  const m = String(mood || "").toLowerCase();
  if (!m) return "natural";
  if (/긴장|tense|suspense|urgent|압박/.test(m)) return "tense";
  if (/차분|calm|soft|gentle/.test(m)) return "calm";
  if (/슬픔|sad|grief/.test(m)) return "sad";
  if (/분노|anger|furious/.test(m)) return "angry";
  if (/기쁨|happy|joy|bright/.test(m)) return "bright";
  return "natural";
};

const parseDialogueLine = (
  line: string,
  defaultSpeaker: string
): { speaker: string; text: string } | null => {
  const raw = normalizeLine(line);
  if (!raw) return null;
  const matched = raw.match(/^([^:：]{1,40})[:：]\s*(.+)$/);
  if (matched) {
    const speaker = normalizeLine(matched[1]) || defaultSpeaker;
    const text = normalizeLine(matched[2]);
    if (!text) return null;
    return { speaker, text };
  }
  return { speaker: defaultSpeaker, text: raw };
};

export const buildKlingI2VPromptPack = (input: {
  series: SeriesSpec;
  page: PageSpec;
}): { prompt: string; negativePrompt: string; settingsHint: string } => {
  const { series, page } = input;
  const panel = page.panels[0];
  const aspectRatio = series.constraints?.i2v_aspect_ratio || "16:9";
  const defaultSpeaker = resolveDefaultSpeaker(series);
  const moodTone = resolveToneByMood(String(panel?.mood || ""));
  const dialogueLines = Array.isArray(panel?.dialogues) ? panel.dialogues : [];
  const normalizedDialogues = dialogueLines
    .map((line) => parseDialogueLine(line, defaultSpeaker))
    .filter((v): v is { speaker: string; text: string } => Boolean(v))
    .slice(0, 2);

  const dialogueBlock =
    normalizedDialogues.length > 0
      ? normalizedDialogues
          .map(
            (item, index) =>
              `${index + 1}. ${item.speaker} (Korean, ${moodTone} tone): "${item.text}"`
          )
          .join("\n")
      : "1. No spoken dialogue for this frame.";

  const prompt = [
    "Use the uploaded image as the first frame; preserve character identity, outfit, style, and background.",
    "Keep continuity with the reference image while adding natural micro-motion and cinematic camera movement.",
    "Treat this as one clip in a connected sequence, not as an isolated shot.",
    `Continuity in from previous clip: ${normalizeLine(String(panel?.i2v_continuity_in || "")) || "Use the uploaded frame as the exact inherited starting state."}`,
    `Action phase: ${normalizeLine(String(panel?.action_phase || "")) || "hold"}`,
    `First-frame pose to preserve: ${normalizeLine(String(panel?.start_pose || "")) || normalizeLine(String(panel?.acting || "")) || "Preserve the exact starting pose in the uploaded frame."}`,
    `Scene intent: ${normalizeLine(String(panel?.scene || "")) || "Maintain current scene context."}`,
    `Acting direction: ${normalizeLine(String(panel?.acting || "")) || "Subtle performance beats, realistic expressions and timing."}`,
    `Motion continuation: ${normalizeLine(String(panel?.motion_continuation || "")) || "Continue naturally from the first-frame pose with subtle cinematic motion."}`,
    `Continuity out for next clip: ${normalizeLine(String(panel?.i2v_continuity_out || "")) || normalizeLine(String(panel?.motion_continuation || "")) || "End with a clear pose, gaze, object position, and emotional state that the next clip can inherit."}`,
    `Camera direction: ${normalizeLine(String(panel?.camera || "")) || "Eye-level medium shot with stable composition."}`,
    `Mood direction: ${normalizeLine(String(panel?.mood || "")) || "Neutral cinematic mood."}`,
    "",
    "Continuity rules:",
    "- Preserve location, outfit, held objects, gaze direction, body orientation, emotional state, and camera direction unless an explicit transition is stated.",
    "- The motion should finish at the continuity-out state so the next clip can start smoothly.",
    "- Avoid sudden resets, unexplained new props, costume changes, or hard camera jumps.",
    "",
    "Audio / Dialogue (speech only, no subtitles):",
    dialogueBlock,
    "",
    "Important: speech only, no subtitles, no captions, no on-screen text."
  ].join("\n");

  const settingsHint = [
    "1) Mode: Image-to-Video",
    "2) Upload the generated frame image",
    `3) Aspect Ratio: ${aspectRatio}`,
    "4) SOUND/Audio: ON (if available)",
    "5) Paste Prompt and Negative Prompt exactly as-is (Duration: 5-8s recommended)"
  ].join("\n");

  return {
    prompt,
    negativePrompt: DEFAULT_NEGATIVE_PROMPT,
    settingsHint
  };
};
