import { NextResponse } from "next/server";
import { requireManager } from "@/lib/access";
import { prisma } from "@/lib/db";
import { exportPayrollCsv, monthKeyForDate } from "@/lib/commissions/engine";

export async function GET(req: Request) {
  try {
    await requireManager();
  } catch {
    return NextResponse.json({ error: "Accès réservé au management commercial." }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month")?.trim() || monthKeyForDate();

  const commissions = await prisma.commission.findMany({
    where: { signedMonth: month },
    include: {
      owner: { select: { name: true, email: true } },
      opportunity: { include: { salon: { select: { name: true } } } },
    },
    orderBy: [{ owner: { name: "asc" } }, { createdAt: "asc" }],
  });

  const csv = exportPayrollCsv(
    commissions.map((c) => ({
      month: c.signedMonth,
      repName: c.owner.name ?? c.owner.email,
      repEmail: c.owner.email,
      salonName: c.opportunity.salon.name,
      mrrSignedEur: c.mrrSignedEur,
      cadence: c.cadence,
      status: c.status,
      commissionEur: c.finalAmountEur,
    })),
  );

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="glaura-paie-${month}.csv"`,
    },
  });
}
