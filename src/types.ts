// 会员优惠与限价发布台 —— 领域模型

export type DiscountType = "none" | "amount" | "percent" | "fixed";
// none    无优惠（按挂牌价）
// amount  直降（元/升）
// percent 折扣率（%，如 95 表示 95 折）
// fixed   直接指定会员到手价

export type OrderStatus = "draft" | "published" | "superseded" | "revoked";
// draft      待发布
// published  已发布（价格冻结，会员侧候选）
// superseded 已被同链新版本取代
// revoked    已撤销（系统已恢复最近有效版本）

export interface Station {
  code: string;
  name: string;
  manager: string;
}

export interface Fuel {
  code: string;
  name: string;
}

export interface PriceLimit {
  stationCode: string;
  fuelCode: string;
  retail: number; // 最高零售价（价格走廊上界）
  costFloor: number; // 成本保护线（价格走廊下界）
  updatedAt: string;
}

export interface Discount {
  type: DiscountType;
  value: number;
}

export interface ReviewInfo {
  reviewer: string;
  basis: string; // 复核依据（触线时必填）
  reviewedAt: string;
}

export interface TagVerify {
  verifier: string;
  tagPrice: number; // 现场价签上的会员价
  verifiedAt: string;
}

export interface PriceOrder {
  id: string;
  code: string; // 单号 TJ-YYYYMMDD-NNN
  stationCode: string;
  fuelCode: string;
  startAt: string; // yyyy-MM-ddTHH:mm
  endAt: string;
  basePrice: number; // 挂牌价（优惠基准）
  discount: Discount;
  finalPrice: number; // 会员到手价（保存时计算落库）
  status: OrderStatus;
  reason: string; // 调整原因（新版本必填）
  createdBy: string;
  createdAt: string;
  publishedAt?: string;
  revokedAt?: string;
  // —— 版本链 ——
  chainId: string; // 同一条价格演变链共享
  versionNo: number;
  parentId?: string;
  // —— 触线复核 ——
  touchesBound: boolean;
  review?: ReviewInfo;
  // —— 价签核验 ——
  tagVerify?: TagVerify;
}

/** 表单模型（含版本链上下文） */
export interface OrderFormModel {
  id?: string; // 编辑草稿时存在
  stationCode: string;
  fuelCode: string;
  startAt: string;
  endAt: string;
  basePrice: number;
  discountType: DiscountType;
  discountValue: number;
  reason: string;
  createdBy: string;
  // 由「调整」带出
  chainId?: string;
  versionNo?: number;
  parentId?: string;
}

export interface Conflict {
  key: string;
  level: "block" | "warn";
  rule: string; // R1..R8
  ruleLabel: string;
  stationCode: string;
  fuelCode: string;
  orderIds: string[];
  periodText: string;
  detail: string;
}
