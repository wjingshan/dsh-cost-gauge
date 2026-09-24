/**
 * 中国法定节假日数据（放假调休日期），供峰谷费率判断使用。
 *
 * ## 为什么需要这份数据
 * DeepSeek 的峰谷计费并不完全按「星期几」来定。官方 2026-09-19 发布的《API 峰谷时间说明》明确：
 *
 *   1. **中国法定节假日全天**按**空闲（标准）时段**计费 —— 即使当天是周一至周五；
 *   2. **调休上班的周末**同样按**空闲时段**计费 —— 即周末永远是空闲时段，补班也不翻倍；
 *   3. 周六、周日全天不再区分峰谷（2026-08-23 00:00 起）。
 *
 * 因此「工作日」的判定必须是：**非周六日 && 非法定节假日**。
 * 只按星期几判断会在中秋、国庆这类「落在工作日的假期」上把费率显示高峰（并让花费估算翻倍）。
 *
 * ## 数据来源
 * 国务院办公厅每年 11 月前后发布次年《关于部分节假日安排的通知》，
 * 本文件按其中的「放假调休日期」逐条录入（放假日即法定节假日）。
 * 每年只需在此追加一个年份条目即可（见下方 `RAW`）。
 *
 * ## 关于年份覆盖
 * 数据未覆盖的年份会退化成「仅按星期几判断」，并在界面上提示。
 * 用 `coveredYears()` / `hasYear()` 可查询覆盖范围。
 */

const PAD2 = (n) => String(n).padStart(2, '0')

/** 把 'YYYY-MM-DD' 区间展开成逐日数组（按 UTC 运算，避免本地时区干扰）。 */
function expandRange(from, to) {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  const out = []
  for (let t = Date.UTC(y1, m1 - 1, d1), end = Date.UTC(y2, m2 - 1, d2); t <= end; t += 86400000) {
    const dt = new Date(t)
    out.push(`${dt.getUTCFullYear()}-${PAD2(dt.getUTCMonth() + 1)}-${PAD2(dt.getUTCDate())}`)
  }
  return out
}

/**
 * 原始数据：年份 → { paper: 文号, url: 出处, holidays: [[节日名, 起, 止]], makeup: [补班日] }。
 *
 * ⚠️ 新增年份时只改这里；`holidays` 的区间写法与国务院通知原文一致（含落在周末的部分，
 * 虽然对费率无影响，但便于逐条核对原文）。
 */
const RAW = {
  2026: {
    paper: '国办发明电〔2025〕7号',
    url: 'https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html',
    holidays: [
      ['元旦', '2026-01-01', '2026-01-03'], // 1/4（周日）上班
      ['春节', '2026-02-15', '2026-02-23'], // 2/14（周六）、2/28（周六）上班
      ['清明节', '2026-04-04', '2026-04-06'],
      ['劳动节', '2026-05-01', '2026-05-05'], // 5/9（周六）上班
      ['端午节', '2026-06-19', '2026-06-21'],
      ['中秋节', '2026-09-25', '2026-09-27'],
      ['国庆节', '2026-10-01', '2026-10-07'], // 9/20（周日）、10/10（周六）上班
    ],
    makeup: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10'],
  },
}

/** 'YYYY-MM-DD' → 节日名。 */
const HOLIDAY_NAME = new Map()
/** 调休补班日（周末上班）集合；仅供展示，不改变费率（这些日子本就是空闲时段）。 */
const MAKEUP = new Set()

for (const [year, entry] of Object.entries(RAW)) {
  for (const [name, from, to] of entry.holidays) {
    for (const date of expandRange(from, to)) {
      // 同一天被两年份/多节日覆盖时保留先写入者（数据本身不应重叠）。
      if (!HOLIDAY_NAME.has(date)) HOLIDAY_NAME.set(date, name)
    }
  }
  for (const date of entry.makeup || []) MAKEUP.add(date)
  if (!Number(year)) throw new Error('holidays: bad year key ' + year)
}

/** 北京时间日历日 → 'YYYY-MM-DD' 键。 */
export function dateKey(year, month, day) {
  return `${year}-${PAD2(month)}-${PAD2(day)}`
}

/** 该日是否为法定节假日；是则返回节日名，否则返回 null。 */
export function holidayNameOf(year, month, day) {
  return HOLIDAY_NAME.get(dateKey(year, month, day)) || null
}

/** 该日是否为法定节假日。 */
export function isHoliday(year, month, day) {
  return HOLIDAY_NAME.has(dateKey(year, month, day))
}

/** 该日是否为「调休上班的周末」补班日。 */
export function isMakeupWorkday(year, month, day) {
  return MAKEUP.has(dateKey(year, month, day))
}

/** 是否已收录该年份的节假日数据。 */
export function hasYear(year) {
  return Object.prototype.hasOwnProperty.call(RAW, year)
}

/** 已收录的年份（升序）。 */
export function coveredYears() {
  return Object.keys(RAW).map(Number).sort((a, b) => a - b)
}

/** 数据出处（供设置面板/README 展示）。 */
export function sources() {
  return Object.entries(RAW).map(([year, e]) => ({ year: Number(year), paper: e.paper, url: e.url }))
}
