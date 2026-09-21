// 会员优惠与限价发布台 —— 领域模型

/** 优惠方式：无优惠 / 每升立减 / 会员折扣 / 固定会员价 */
export type DiscountMethod = "none" | "perLiter" | "percent" | "fixed";

/** 调价单状态：待发布 / 已发布 / 已撤销 / 已替代（旧版本） */
export type OrderStatus = "pending" | "published" | "revoked" | "superseded";

export interface Station {
  id: string;
  name: string;
  manager: string;
}

export interface Fuel {
  id: string;
  name: string;
}

/** 限价：最高零售价（上限）与成本保护线（下限） */
export interface PriceLimit {
  ceiling: number;
  floor: number;
}

export interface ReviewInfo {
  reviewer: string;
  basis: string;
  at: string;
}

export interface TagCheck {
  checker: string;
  at: string;
}

export interface PriceOrder {
  id: string;
  /** 调价单号 */
  code: string;
  stationId: string;
  fuelId: string;
  /** 时段（半开区间 [startAt, endAt)，本地时间 yyyy-MM-ddTHH:mm） */
  startAt: string;
  endAt: string;
  /** 挂牌价（最高零售价的基准） */
  listPrice: number;
  method: DiscountMethod;
  /** 立减金额 / 折扣百分比(如 95 表示 95 折) / 固定价；无优惠时为 0 */
  discountValue: number;
  /** 优惠后到手价（保存时按规则计算并冻结快照） */
  finalPrice: number;
  /** 限价快照：随单留存，便于复核与重载后还原 */
  ceiling: number;
  floor: number;
  status: OrderStatus;
  /** 调价/优惠原因 */
  reason: string;
  operator: string;
  /** 本单由哪个已发布版本调整而来，构成版本链 */
  basedOnId: string | null;
  /** 同站同油品版本号，从 1 递增 */
  versionNo: number;
  /** 触线复核信息（碰到上/下限且经站长复核时存在） */
  review: ReviewInfo | null;
  /** 价签核验信息 */
  tagCheck: TagCheck | null;
  revokeReason: string | null;
  createdAt: string;
  publishedAt: string | null;
  /** manual=本台新建；import=历史导入（可能带冲突） */
  origin: "manual" | "import";
}

/** 新建/修改调价单时的表单输入 */
export interface OrderDraft {
  stationId: string;
  fuelId: string;
  startAt: string;
  endAt: string;
  listPrice: number | null;
  method: DiscountMethod;
  discountValue: number | null;
  reason: string;
  operator: string;
}

export type PricePosition = "ok" | "ceiling" | "floor" | "over" | "under";

export type RuleId =
  | "OVERLAP"
  | "OVER_CEILING"
  | "UNDER_FLOOR"
  | "TOUCH_UNREVIEWED"
  | "TAG_UNVERIFIED"
  | "BROKEN_LINK";

export interface ConflictItem {
  key: string;
  ruleId: RuleId;
  ruleLabel: string;
  detail: string;
  stationId: string;
  fuelId: string;
  startAt: string;
  endAt: string;
  /** 命中规则的调价单（重叠为两单，其余为一单） */
  orderIds: string[];
  /** 是否拦截发布 */
  blockPublish: boolean;
}
