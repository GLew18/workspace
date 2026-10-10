// Cobalt: the one assessment-word matcher shared by the Tasks view and the store.
// (It used to live in the Schoology iCal parser, removed 10/9/26 when Schoology
// became OAuth-only.)

// The Tasks view's BADGE matcher is narrow ON PURPOSE (per Gabe): quiz/test/exam
// earn the red pill, but not "final"/"midterm", which are too often ordinary title
// words ("final draft"). "Exam" is in (Gabe 8/6): unlike "final", it only ever
// means an assessment.
export const BADGE_ASSESSMENT_RE = /\b(quiz|quizzes|test|tests|exam|exams)\b/i;
