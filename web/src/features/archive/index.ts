// 云端档案（development.md §5.4 / §7）—— 本轮无后端：
// 清除本地档案副本（画像 + 解读冗余），接口形状与未来后端对齐，TODO 标注在接入点。

import { db } from '../../db/db';
import { createEmptyProfile } from '../memory/types';

export interface ArchiveDeleteResult {
  cleared: {
    /** 画像是否已重置为空档案 */
    profile: boolean;
    /** 被清除的解读冗余条数（书页 + 草稿） */
    interpretations: number;
  };
}

/**
 * 删除我所有云端档案。
 * TODO(后端对接): 未来实现为 DELETE /api/archive（见 docs/api-contract.md）——
 * 服务端删除立绘产物 / 解读日志 / 画像云端副本；本函数为本地副本清理 + 文案注明，
 * 照片原图与书页内容（含日记）不属于云端档案，不受影响。
 */
export async function deleteCloudArchive(): Promise<ArchiveDeleteResult> {
  const pages = await db.pages.toArray();
  const drafts = await db.drafts.toArray();

  // 解读日志冗余：书页与草稿上的 interpretation 字段
  let interpretations = 0;
  for (const p of pages) {
    if (p.interpretation) {
      await db.pages.update(p.id, { interpretation: undefined });
      interpretations++;
    }
  }
  for (const d of drafts) {
    if (d.interpretation) {
      await db.drafts.update(d.id, { interpretation: undefined });
      interpretations++;
    }
  }

  // 画像档案：重置为空画像（§8.2 单用户 'me'）
  const fresh = createEmptyProfile();
  await db.profile.put({ id: 'me', data: fresh, updatedAt: fresh.updatedAt });

  return { cleared: { profile: true, interpretations } };
}
