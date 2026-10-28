export const routes = {
  home: "/",
  login: "/login",
  library: "/bibliotheque",
  generate: "/generer",
  session: (id: string) => `/sessions/${id}` as const,
  code: "/code",
  sql: "/sql",
  progress: "/progression",
  settings: "/reglages",
} as const;
