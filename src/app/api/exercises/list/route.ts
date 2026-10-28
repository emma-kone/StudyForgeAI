import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/api-helpers";

export async function GET() {
  return handle(async () => {
    const user = await requireUser();
    const exercises = await db.exercise.findMany({
      where: { userId: user.id },
      include: { subject: { select: { name: true, color: true } } },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    return {
      exercises: exercises.map((e) => ({
        id: e.id,
        title: e.title,
        subject: e.subject,
        config: JSON.parse(e.config || "{}"),
        questionCount: (JSON.parse(e.questions) as unknown[]).length,
        status: e.status,
        createdAt: e.createdAt,
      })),
    };
  });
}
