import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";

/** Statistiques réelles du tableau de bord — calculées depuis les données enregistrées. */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const [subjects, documents, sessions, sessionCounts, stats, recommendations, aiLogs] = await Promise.all([
      db.subject.findMany({
        where: { userId: user.id },
        include: { _count: { select: { documents: true, sessions: true } } },
        orderBy: { createdAt: "asc" },
      }),
      db.document.findMany({ where: { userId: user.id }, select: { status: true, type: true, size: true } }),
      db.session.findMany({
        where: { userId: user.id },
        orderBy: { startedAt: "desc" },
        take: 60,
        include: { subject: { select: { name: true, color: true } } },
      }),
      // Comptes réels (non tronqués par take:60)
      db.session.groupBy({ by: ["status"], where: { userId: user.id }, _count: { _all: true } }),
      db.conceptStat.findMany({ where: { userId: user.id }, orderBy: { lastSeen: "desc" }, take: 40 }),
      db.studyRecommendation.findMany({ where: { userId: user.id, status: "OPEN" }, orderBy: { priority: "desc" }, take: 8 }),
      db.aIUsageLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200 }),
    ]);

    const countFor = (status: string) => sessionCounts.find((c) => c.status === status)?._count._all ?? 0;
    const sessionsTotal = sessionCounts.reduce((acc, c) => acc + c._count._all, 0);

    const graded = sessions.filter((s) => s.status === "GRADED" && s.percentage != null);
    const overallAvg = graded.length ? Math.round((graded.reduce((a, s) => a + (s.percentage ?? 0), 0) / graded.length) * 10) / 10 : null;

    const bySubject = subjects.map((sub) => {
      const subSessions = graded.filter((s) => s.subjectId === sub.id);
      return {
        id: sub.id,
        name: sub.name,
        color: sub.color,
        documents: sub._count.documents,
        sessions: sub._count.sessions,
        avg: subSessions.length ? Math.round((subSessions.reduce((a, s) => a + (s.percentage ?? 0), 0) / subSessions.length) * 10) / 10 : null,
      };
    });

    // Évolution des notes (chronologique)
    const timeline = [...graded]
      .reverse()
      .map((s) => ({ date: s.finishedAt?.toISOString() ?? s.startedAt.toISOString(), label: s.title.slice(0, 28), percentage: s.percentage ?? 0, mode: s.mode }));

    const workMinutes = Math.round(graded.reduce((a, s) => a + (s.durationSec ?? 0), 0) / 60);
    const aiCalls = aiLogs.length;
    const aiErrors = aiLogs.filter((l) => !l.ok).length;
    const recentErrors = aiLogs.filter((l) => !l.ok).slice(0, 5);

    return {
      counts: {
        subjects: subjects.length,
        documents: documents.length,
        documentsReady: documents.filter((d) => d.status === "READY").length,
        documentsError: documents.filter((d) => d.status === "ERROR").length,
        sessionsTotal,
        sessionsGraded: countFor("GRADED"),
        sessionsInProgress: countFor("IN_PROGRESS"),
      },
      overallAvg,
      bySubject,
      timeline,
      workMinutes,
      conceptStats: stats.map((c) => ({ notion: c.notion, mastery: c.mastery, attempts: c.attempts, correct: c.correct, lastSeen: c.lastSeen })),
      recommendations,
      recentSessions: sessions.slice(0, 8).map((s) => ({
        id: s.id,
        title: s.title,
        mode: s.mode,
        status: s.status,
        percentage: s.percentage,
        score: s.score,
        maxScore: s.maxScore,
        startedAt: s.startedAt,
        subject: s.subject,
      })),
      ai: { calls: aiCalls, errors: aiErrors, recentErrors },
      examResults: graded.filter((s) => s.mode === "examen").map((s) => ({ id: s.id, title: s.title, percentage: s.percentage, finishedAt: s.finishedAt })),
    };
  });
}
