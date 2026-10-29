export const routes = {
  home: "/",
  login: "/login",
  library: "/bibliotheque",
  chapterReader: (chapterId: string) => `/bibliotheque/${chapterId}` as const,
  generate: "/generer",
  session: (id: string) => `/sessions/${id}` as const,
  code: "/code",
  sql: "/sql",
  progress: "/progression",
  settings: "/reglages",
} as const;
