/**
 * @jest-environment node
 */
import {
  normalizeSeriesName,
  normalizeSeriesNames,
  groupPostsBySeries,
  getAllSeriesNames
} from '@/lib/utils/series'

describe('series 属性类型兼容（rich_text -> select/multi_select 下拉）', () => {
  describe('normalizeSeriesName', () => {
    it('text 类型字符串去空格后返回', () => {
      expect(normalizeSeriesName('  Cloudflare建站实践 ')).toBe('Cloudflare建站实践')
    })
    it('select/multi_select 返回的数组收敛为字符串', () => {
      expect(normalizeSeriesName(['Cloudflare建站实践'])).toBe('Cloudflare建站实践')
    })
    it('数组含空值时取第一个非空项', () => {
      expect(normalizeSeriesName(['', '系列A'])).toBe('系列A')
    })
    it('空值返回空字符串且不抛错', () => {
      expect(normalizeSeriesName(undefined)).toBe('')
      expect(normalizeSeriesName(null)).toBe('')
      expect(normalizeSeriesName([])).toBe('')
      expect(normalizeSeriesName('')).toBe('')
    })
  })

  describe('normalizeSeriesNames（多选）', () => {
    it('多选返回全部系列名', () => {
      expect(normalizeSeriesNames(['系列A', '系列B'])).toEqual(['系列A', '系列B'])
    })
    it('去重且过滤空值', () => {
      expect(normalizeSeriesNames(['系列A', '', '系列A'])).toEqual(['系列A'])
    })
    it('非数组按单值处理', () => {
      expect(normalizeSeriesNames('系列A')).toEqual(['系列A'])
      expect(normalizeSeriesNames(null)).toEqual([])
    })
  })

  describe('groupPostsBySeries', () => {
    it('下拉数组类型可正确分组（回归：此前 typeof string 判断失败）', () => {
      const { grouped, ungrouped } = groupPostsBySeries([
        { id: '1', series: ['系列A'], publishDate: 3 },
        { id: '2', series: ['系列A'], publishDate: 2 },
        { id: '3', series: ['系列B'], publishDate: 1 }
      ])
      expect(ungrouped).toHaveLength(0)
      expect(grouped).toHaveLength(2)
      expect(grouped.find(g => g.series === '系列A').posts).toHaveLength(2)
      expect(grouped.find(g => g.series === '系列B').posts).toHaveLength(1)
    })
    it('多选时文章出现在其所属的每个系列中', () => {
      const { grouped } = groupPostsBySeries([
        { id: '1', series: ['系列A', '系列B'], publishDate: 1 }
      ])
      expect(grouped.map(g => g.series).sort()).toEqual(['系列A', '系列B'])
      expect(grouped.every(g => g.posts.length === 1)).toBe(true)
    })
    it('字符串类型（原 text 行为）不受影响', () => {
      const { grouped } = groupPostsBySeries([
        { id: '1', series: '系列A', publishDate: 1 }
      ])
      expect(grouped).toHaveLength(1)
      expect(grouped[0].series).toBe('系列A')
    })
    it('无 series 的文章进入 ungrouped', () => {
      const { grouped, ungrouped } = groupPostsBySeries([
        { id: '1', series: [], publishDate: 1 },
        { id: '2', publishDate: 1 }
      ])
      expect(grouped).toHaveLength(0)
      expect(ungrouped).toHaveLength(2)
    })
    it('组内按 number 升序（number 为下拉数组时同样生效）', () => {
      const { grouped } = groupPostsBySeries([
        { id: 'a', series: 'S', number: ['2'], publishDate: 1 },
        { id: 'b', series: 'S', number: ['1'], publishDate: 1 }
      ])
      expect(grouped[0].posts.map(p => p.id)).toEqual(['b', 'a'])
    })
  })

  describe('getAllSeriesNames（生成 /series 静态路径）', () => {
    it('数组与字符串混合时都能取到系列名', () => {
      expect(
        getAllSeriesNames([
          { series: ['系列A'] },
          { series: '系列B' },
          { series: [] }
        ]).sort()
      ).toEqual(['系列A', '系列B'])
    })
  })
})
