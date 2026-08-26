// 书浏览 mock 数据（t6 主流程未完成前的开发兜底）：
// 页图沿用 lab 演示（three/demo/mockAssets），每页配独立立绘图层（variant 色板）与日记。

import { makeMockLayers, makeMockPages } from '../../three/demo/mockAssets';
import type { BookPageItem } from './types';

const MOCK_DIARIES = [
  '那天你站在窗边看了很久，猫在你脚边打盹。你忽然觉得，这样的下午再多几个也不嫌多。',
  '你记得雨停后空气里的味道。路边的叶子亮得不像话，你拍了又拍，最后还是选了这张。',
  '傍晚的风把云吹成薄薄一片。你说，日子好像也没那么赶，慢慢走，也能到。',
  '海浪一层一层地来，你蹲在沙滩上等它。等来的不是贝壳，是一整个下午的安静。',
  '你把银杏叶夹进书里，说等它干了，就是秋天寄来的信。',
  '那盏灯亮到很晚。你写了几个字又删掉，最后只留下一句：今天很好，明天也试试。',
];

/** 生成 count 页 mock 书数据：页图 + 每页立绘图层（variant 区分）+ 日记 */
export async function makeMockItems(count = 6): Promise<BookPageItem[]> {
  const pages = await makeMockPages(count);
  const items: BookPageItem[] = [];
  for (let i = 0; i < pages.length; i++) {
    items.push({
      id: pages[i].id,
      month: pages[i].month,
      image: pages[i].image,
      diary: MOCK_DIARIES[i % MOCK_DIARIES.length],
      layers: await makeMockLayers(i),
    });
  }
  return items;
}
