-- =====================================================================
--  QC Cost & Output  —  BigQuery layer
--  Project : inspired-frame-453018-r2
--  Dataset : spyne_reviews
--
--  Joins delivery_working_data.QC  <->  salary_sheet.`Work Email`
--  at employee x month grain, and allocates each QC's monthly salary
--  across their rows in proportion to Images. Allocated cost is
--  additive, so SUM(alloc_cost) is correct under any filter combination.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. BASE VIEW
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW `inspired-frame-453018-r2.spyne_reviews.v_qc_cost` AS
WITH d_raw AS (
  SELECT
    -- Hourly_Date may land as DATETIME/TIMESTAMP or as the sheet string
    -- "1 Apr, 2026, 0:00". Try each shape, keep the first that parses.
    COALESCE(
      SAFE_CAST(Hourly_Date AS DATETIME),
      SAFE.PARSE_DATETIME("%e %b, %Y, %H:%M", CAST(Hourly_Date AS STRING)),
      SAFE.PARSE_DATETIME("%e %b %Y %H:%M",   CAST(Hourly_Date AS STRING)),
      SAFE.PARSE_DATETIME("%d/%m/%Y %H:%M",   CAST(Hourly_Date AS STRING))
    )                                            AS ts,
    NULLIF(TRIM(Product),     "")                AS product,
    NULLIF(TRIM(Verticle),    "")                AS verticle,
    NULLIF(TRIM(Type),        "")                AS work_type,
    NULLIF(TRIM(Enterprise_id), "")              AS enterprise_id,
    NULLIF(TRIM(Enterprise),  "")                AS enterprise,
    NULLIF(TRIM(Team_id),     "")                AS team_id,
    NULLIF(TRIM(Team_Name),   "")                AS team_name,
    NULLIF(TRIM(Dealer_Type), "")                AS dealer_type,
    LOWER(TRIM(QC))                              AS qc_email,
    IFNULL(SAFE_CAST(Images     AS INT64),   0)  AS images,
    IFNULL(SAFE_CAST(Tool_Count AS INT64),   0)  AS tool_count,
    IFNULL(SAFE_CAST(SKU_Count  AS INT64),   0)  AS sku_count,
    IFNULL(SAFE_CAST(Sum_Target AS FLOAT64), 0)  AS target
  FROM `inspired-frame-453018-r2.spyne_reviews.delivery_working_data`
),

d AS (
  SELECT
    * EXCEPT(ts),
    DATE(ts)                                   AS work_date,
    EXTRACT(HOUR      FROM ts)                 AS work_hour,
    EXTRACT(DAYOFWEEK FROM ts)                 AS work_dow,   -- 1 = Sunday
    DATE_TRUNC(DATE(ts), MONTH)                AS month_start,
    FORMAT_DATE("%b'%y", DATE(ts))             AS month_key
  FROM d_raw
  WHERE ts IS NOT NULL
    -- drop junk QC values (blank, "₹", names without an @, etc.)
    AND REGEXP_CONTAINS(qc_email, r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
),

s AS (
  SELECT
    -- normalise curly apostrophe so Jul’26 and Jul'26 both match
    REPLACE(TRIM(CAST(Month AS STRING)), "\u2019", "'")  AS month_key,
    CAST(`Employee Number` AS STRING)                    AS emp_no,
    TRIM(CAST(`Employee Name` AS STRING))                AS emp_name,
    LOWER(TRIM(CAST(`Work Email` AS STRING)))            AS qc_email,
    SUM(IFNULL(SAFE_CAST(Salary AS FLOAT64), 0))         AS salary
  FROM `inspired-frame-453018-r2.spyne_reviews.salary_sheet`
  WHERE `Work Email` IS NOT NULL AND TRIM(CAST(`Work Email` AS STRING)) != ""
  GROUP BY 1, 2, 3, 4
),

-- denominator for the allocation: everything a QC produced that month,
-- computed BEFORE any dashboard filter is applied
qm AS (
  SELECT qc_email, month_key, SUM(images) AS qc_month_images
  FROM d
  GROUP BY 1, 2
)

SELECT
  d.month_key,
  d.month_start,
  d.work_date,
  d.work_hour,
  d.work_dow,
  d.product,
  d.verticle,
  d.work_type,
  d.enterprise_id,
  d.enterprise,
  d.team_id,
  d.team_name,
  d.dealer_type,
  d.qc_email,
  s.emp_no,
  s.emp_name,
  d.images,
  d.tool_count,
  d.sku_count,
  d.target,
  s.salary                                                       AS qc_month_salary,
  qm.qc_month_images,
  SAFE_DIVIDE(s.salary * d.images, NULLIF(qm.qc_month_images, 0)) AS alloc_cost,
  s.qc_email IS NOT NULL                                          AS is_matched
FROM d
LEFT JOIN qm ON qm.qc_email = d.qc_email AND qm.month_key = d.month_key
LEFT JOIN s  ON s.qc_email  = d.qc_email AND s.month_key  = d.month_key
;


-- ---------------------------------------------------------------------
-- 2. FACT  —  main dashboard payload (Apps Script key: "fact")
--    Grain: month x enterprise x team x product x work_type
--           x dealer_type x QC
-- ---------------------------------------------------------------------
SELECT
  month_key, month_start,
  enterprise_id, enterprise, team_id, team_name, dealer_type,
  product, work_type, verticle,
  qc_email, emp_no, emp_name, is_matched,
  MAX(qc_month_salary)          AS qc_month_salary,
  MAX(qc_month_images)          AS qc_month_images,
  COUNT(DISTINCT work_date)     AS active_days,
  SUM(images)                   AS images,
  SUM(sku_count)                AS skus,
  SUM(tool_count)               AS tool_count,
  SUM(target)                   AS target,
  SUM(alloc_cost)               AS cost
FROM `inspired-frame-453018-r2.spyne_reviews.v_qc_cost`
GROUP BY 1,2,3,4,5,6,7,8,9,10,11,12,13,14
;


-- ---------------------------------------------------------------------
-- 3. HEAT  —  shift coverage (Apps Script key: "heat")
-- ---------------------------------------------------------------------
SELECT
  month_key, work_dow, work_hour,
  SUM(images) AS images,
  SUM(alloc_cost) AS cost,
  COUNT(DISTINCT qc_email) AS qcs
FROM `inspired-frame-453018-r2.spyne_reviews.v_qc_cost`
GROUP BY 1,2,3
;


-- ---------------------------------------------------------------------
-- 4. GAPS  —  reconciliation (Apps Script key: "gaps")
--    a) output with no matching payroll row
--    b) payroll rows with no output that month
-- ---------------------------------------------------------------------
SELECT "output_without_salary" AS gap_type, month_key, qc_email,
       CAST(NULL AS STRING) AS emp_no, CAST(NULL AS STRING) AS emp_name,
       SUM(images) AS images, 0.0 AS salary
FROM `inspired-frame-453018-r2.spyne_reviews.v_qc_cost`
WHERE NOT is_matched
GROUP BY 1,2,3

UNION ALL

SELECT "salary_without_output", s.month_key, s.qc_email,
       CAST(s.emp_no AS STRING), s.emp_name,
       0 AS images, SUM(IFNULL(SAFE_CAST(s.Salary AS FLOAT64),0)) AS salary
FROM (
  SELECT REPLACE(TRIM(CAST(Month AS STRING)), "\u2019", "'") AS month_key,
         CAST(`Employee Number` AS STRING) AS emp_no,
         TRIM(CAST(`Employee Name` AS STRING)) AS emp_name,
         LOWER(TRIM(CAST(`Work Email` AS STRING))) AS qc_email,
         Salary
  FROM `inspired-frame-453018-r2.spyne_reviews.salary_sheet`
) s
LEFT JOIN (
  SELECT DISTINCT qc_email, month_key
  FROM `inspired-frame-453018-r2.spyne_reviews.v_qc_cost`
) d ON d.qc_email = s.qc_email AND d.month_key = s.month_key
WHERE d.qc_email IS NULL
GROUP BY 1,2,3,4,5
;
