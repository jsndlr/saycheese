/**
 * Every user-visible upload and score string lives here so the components and
 * their tests agree on one source of truth.
 */
export const UPLOAD_COPY = {
  heading: "Score a smile",
  intro: "Upload a photo. We check faces and rate the smile from 0 to 100.",
  choosePhoto: "Choose a photo",
  dropHint: "or drag and drop it here",
  formats: "JPEG, PNG or WebP, up to 8 MB.",
  dropActive: "Drop the photo to upload",
  hashing: "Hashing your photo…",
  uploading: "Uploading your photo",
  committing: "Committing your photo…",
  uploadingPercent: (percent: number) => `Uploading ${percent}%`,
  deduplicated: "You already uploaded this photo",
  resultLoading: "Loading your result…",
  historyHeading: "Your history",
  historyPlaceholder: "Your photo history will appear here.",
  signedInAs: "Signed in as",
  signOut: "Sign out",
  retry: "Try again",
  cancel: "Cancel",
  changeFile: "Choose another photo",
  signIn: "Sign in",
  release: (release: string) => `Scoring config release ${release}`,
} as const;

export const SCORE_COPY = {
  panelHeading: "Your score",
  checking: "Checking your photo…",
  scoring: "Scoring…",
  scoreSuffix: "out of 100",
  confidence: (percent: number) => `${percent}% confidence`,
  cached: "Cached result",
  provider: {
    rekognition: "Amazon Rekognition",
    vision: "Google Cloud Vision",
    stub: "Stub provider",
  },
  scoredBy: (provider: string) => `Scored by ${provider}`,
  multipleFaces: (count: number) =>
    `Scored the largest of ${count} ${count === 1 ? "face" : "faces"}`,
  noFace: "No face detected",
  lowQualityFallback: "Photo quality is too low to score",
  unavailableFallback: "Scoring is unavailable",
  quotaReset: (when: string) => `Your daily limit resets on ${when}.`,
  quotaResetPassed: "Your daily limit has reset. Rescore this photo.",
  rescore: "Try scoring again",
  changeFile: "Choose another photo",
  noScore: "No score is available for this photo.",
  previewAlt: "Your uploaded photo",
  announceScore: (score: number) => `Smile score ${score} out of 100.`,
  announceMultipleFaces: (score: number, count: number) =>
    `Smile score ${score} out of 100. Scored the largest of ${count} ${count === 1 ? "face" : "faces"}.`,
  announceConfidence: (percent: number) => `Confidence ${percent} percent.`,
  announceCached: "This is a cached result.",
} as const;