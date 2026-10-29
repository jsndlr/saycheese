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
  signedInAs: "Signed in as",
  signOut: "Sign out",
  retry: "Try again",
  cancel: "Cancel",
  changeFile: "Choose another photo",
  signIn: "Sign in",
  release: (release: string) => `Scoring config release ${release}`,
} as const;

export const HISTORY_COPY = {
  empty: "No photos yet. Upload one to get a score.",
  loading: "Loading your photos…",
  loadingMore: "Loading more photos…",
  loadMore: "Load more",
  cached: "Cached",
  thumbnailAlt: (uploaded: string) => `Photo uploaded ${uploaded}`,
  status: {
    uploaded: "Uploading",
    processing: "Processing",
    scoring: "Scoring",
    scored: "Scored",
    failed: "Failed",
    noFace: "No face",
    multipleFaces: "Multiple faces",
    lowQuality: "Low quality",
    unavailable: "Unavailable",
  },
} as const;

export const IMAGE_DETAIL_COPY = {
  heading: "Photo details",
  back: "Back to your photos",
  uploaded: "Uploaded",
  dimensions: "Dimensions",
  size: "Size",
  dimensionsValue: (width: number, height: number) => `${width} × ${height} px`,
  unknownValue: "Not available",
  notFoundHeading: "Photo not found",
  notFound: "This photo is not available.",
  archive: "Archive photo",
  archiveQuestion: "Archive this photo? It disappears from your history.",
  archivePending: "Archiving…",
  archiveBlocked: "Wait until scoring finishes",
  archivedToast: "Photo archived",
  signIn: "Sign in",
} as const;

/** Shared labels for the inline confirm step; both flows must read the same. */
export const CONFIRM_COPY = {
  confirm: "Confirm",
  cancel: "Cancel",
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
  unavailableFallback: "Scoring is unavailable",
  quotaReset: (when: string) => `Your daily limit resets on ${when}.`,
  quotaResetPrefix: "Your daily limit resets on",
  quotaResetPassed: "Your daily limit has reset. Rescore this photo.",
  rescore: "Try scoring again",
  scoreAgain: "Score again",
  scoreAgainQuestion:
    "Score this photo again? This uses one rescore from your hourly limit.",
  changeFile: "Choose another photo",
  noScore: "No score is available for this photo.",
  previewAlt: "Your uploaded photo",
  announceScore: (score: number) => `Smile score ${score} out of 100.`,
  announceMultipleFaces: (score: number, count: number) =>
    `Smile score ${score} out of 100. Scored the largest of ${count} ${count === 1 ? "face" : "faces"}.`,
  announceConfidence: (percent: number) => `Confidence ${percent} percent.`,
  announceCached: "This is a cached result.",
  signIn: "Sign in",
} as const;