const DAILY_LIMIT_USD = Number(process.env.OPENAI_DAILY_LIMIT_USD || 3);
const MONTHLY_LIMIT_USD = Number(process.env.OPENAI_MONTHLY_LIMIT_USD || 25);
const VA_DAILY_LIMIT_USD = Number(process.env.VA_DAILY_LIMIT_USD || 2);

async function getSpendSummary(supabase, organizationId = null) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  let dailyQuery = supabase
    .from("api_usage_logs")
    .select("estimated_cost_usd, feature")
    .gte("created_at", todayStart.toISOString());

  let monthlyQuery = supabase
    .from("api_usage_logs")
    .select("estimated_cost_usd, feature")
    .gte("created_at", monthStart.toISOString());

  if (organizationId) {
    dailyQuery = dailyQuery.eq("organization_id", organizationId);
    monthlyQuery = monthlyQuery.eq("organization_id", organizationId);
  }

  const { data: dailyRows, error: dailyError } = await dailyQuery;
  if (dailyError) {
    throw dailyError;
  }

  const { data: monthlyRows, error: monthlyError } = await monthlyQuery;
  if (monthlyError) {
    throw monthlyError;
  }

  const dailySpend = (dailyRows || []).reduce(
    (sum, row) => sum + Number(row.estimated_cost_usd || 0),
    0
  );

  const monthlySpend = (monthlyRows || []).reduce(
    (sum, row) => sum + Number(row.estimated_cost_usd || 0),
    0
  );

  const vaDailySpend = (dailyRows || [])
    .filter((row) => String(row.feature || "").startsWith("va_"))
    .reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0);

  return {
    dailySpend: Number(dailySpend.toFixed(6)),
    monthlySpend: Number(monthlySpend.toFixed(6)),
    vaDailySpend: Number(vaDailySpend.toFixed(6)),
    dailyRemaining: Number(Math.max(0, DAILY_LIMIT_USD - dailySpend).toFixed(6)),
    monthlyRemaining: Number(
      Math.max(0, MONTHLY_LIMIT_USD - monthlySpend).toFixed(6)
    ),
    vaDailyRemaining: Number(
      Math.max(0, VA_DAILY_LIMIT_USD - vaDailySpend).toFixed(6)
    ),
    limits: {
      daily: DAILY_LIMIT_USD,
      monthly: MONTHLY_LIMIT_USD,
      vaDaily: VA_DAILY_LIMIT_USD,
    },
  };
}

async function assertBudgetAvailable({
  supabase,
  organizationId = null,
  feature = "",
}) {
  const summary = await getSpendSummary(supabase, organizationId);

  if (summary.dailySpend >= DAILY_LIMIT_USD) {
    throw new Error(`Daily API budget reached. Limit: $${DAILY_LIMIT_USD}`);
  }

  if (summary.monthlySpend >= MONTHLY_LIMIT_USD) {
    throw new Error(`Monthly API budget reached. Limit: $${MONTHLY_LIMIT_USD}`);
  }

  if (String(feature).startsWith("va_") && summary.vaDailySpend >= VA_DAILY_LIMIT_USD) {
    throw new Error(`VA daily AI budget reached. Limit: $${VA_DAILY_LIMIT_USD}`);
  }

  return summary;
}

module.exports = {
  getSpendSummary,
  assertBudgetAvailable,
};
