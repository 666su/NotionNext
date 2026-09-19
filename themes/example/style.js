/* eslint-disable react/no-unknown-property */
import CONFIG from './config'
import { themeConsoleStyle } from '@/lib/themeConsoleStyle'

/**
 * 姝ゅ鏍峰紡鍙褰撳墠涓婚鐢熸晥
 * 姝ゅ涓嶆敮鎸乼ailwindCSS鐨?@apply 璇硶
 * @returns
 */
const Style = () => {
  return <style jsx global>{`

    /*
     * ==============================
     * 娣辫壊妯″紡
     * ==============================
     */

    .dark body {

        background-color: #0d1117;

    }





    /*
     * ==============================
     * 鏂囩珷鏍囬灞呬腑
     * ==============================
     */

    #theme-example .border-b h1 {

        text-align: center !important;

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 姝ｆ枃棣栬缂╄繘
     * ==============================
     */


    #theme-example .notion-text {

        text-indent: 2em !important;

        line-height: 1.8;

        margin-bottom: 1em;

    }





    /*
     * ==============================
     * 鏈夊簭鍒楄〃 / 鏃犲簭鍒楄〃
     * ==============================
     *
     * HTML:
     *
     * <ol class="notion-list notion-list-numbered">
     *
     */


    #theme-example ol.notion-list,
    #theme-example ul.notion-list {

        padding-left: 32px !important;

        text-indent: 0 !important;

        line-height: 1.8;

    }



    #theme-example ol.notion-list li,
    #theme-example ul.notion-list li {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * Callout鍙栨秷缂╄繘
     * ==============================
     */


    #theme-example .notion-callout-text .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 寮曠敤鍙栨秷缂╄繘
     * ==============================
     */


    #theme-example .notion-quote .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 浠ｇ爜鍧楀彇娑堢缉杩?
     * ==============================
     */


    #theme-example .notion-code .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 鍥剧墖璇存槑鍙栨秷缂╄繘
     * ==============================
     */


    #theme-example .notion-image .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 琛ㄦ牸鍙栨秷缂╄繘
     * ==============================
     */


    #theme-example .notion-table .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 鍒嗗壊绾?
     * ==============================
     */


    #theme-example hr {

        margin-top: 24px;

        margin-bottom: 24px;

    }





    /*
     * ==============================
     * 鍘熶富棰橀厤缃?
     * ==============================
     */


    
    /*
     * ==============================
     * 新增文章系列展示功能 - 系列分组样式
     * ==============================
     */


    #theme-example .series-group {

        padding: 0.25rem;

    }



    #theme-example .series-group-header {

        position: relative;

    }



    #theme-example .series-card {

        height: 100%;

    }



    /* 新增文章系列展示功能：编号徽章内图标与数字严格水平对齐 */
    #theme-example .series-badge {

        vertical-align: middle;

        line-height: 1;

    }



    #theme-example .series-badge i {

        display: inline-flex;

        align-items: center;

        justify-content: center;

        line-height: 1;

        font-size: 0.9em;

        position: relative;

        top: -0.5px;

    }



    #theme-example .series-badge span {

        line-height: 1;

    }



    /* 移动端适配：强制单列 + 紧凑间距 */
    @media (max-width: 768px) {

        #theme-example .series-grid {

            grid-template-columns: 1fr !important;

            gap: 1rem !important;

        }



        #theme-example .series-group {

            margin-bottom: 2rem !important;

        }



        #theme-example .series-group-header {

            margin-bottom: 1rem !important;

            padding-bottom: 0.5rem !important;

        }



        #theme-example .series-group-header h2 {

            font-size: 1.25rem !important;

        }



        /* 内容区减少内边距 */

        #theme-example #container-inner > div > div:first-child {

            padding-left: 0.75rem !important;

            padding-right: 0.75rem !important;

        }



        /* 布局切换按钮居中 */

        #theme-example .layout-switcher {

            justify-content: center !important;

        }

    }



    /* 导航菜单隐藏滚动条（移动端水平滚动） */
    #theme-example .menu-scroll-hide {

        -ms-overflow-style: none;

        scrollbar-width: none;

    }



    #theme-example .menu-scroll-hide::-webkit-scrollbar {

        display: none;

    }



    /* 新增移动端适配：抽屉侧边栏 */
    #theme-example .mobile-menu-btn:focus {

        outline: none;

    }



    /* 抽屉打开时锁定背景滚动 */
    body.drawer-open {

        overflow: hidden !important;

    }



    /* 新增移动端适配：文章详情页紧凑布局 */
    @media (max-width: 768px) {

        #theme-example #article-wrapper {

            padding-left: 0.5rem !important;

            padding-right: 0.5rem !important;

        }



        #theme-example #notion-article {

            line-height: 1.75 !important;

        }



        /* 移动端隐藏回顶按钮的多余间距 */

        #theme-example .fixed.right-4.bottom-4 {

            right: 0.75rem !important;

            bottom: 0.75rem !important;

        }



        /* 新增移动端适配：系列手风琴列表 */

        #theme-example .mobile-series-list {

            margin-top: 0.5rem;

        }



        #theme-example .mobile-series-list button:focus {

            outline: none;

        }

    }



    /* 新增文章系列展示功能：文字大小调节（桌面端 + 移动端通用） */
    #theme-example #notion-article p,

    #theme-example #notion-article li,

    #theme-example #notion-article td,

    #theme-example #notion-article th {

        font-size: calc(1em * var(--article-font-scale, 1));

    }



    /*
     * ==============================
     * 新增文章系列展示功能 - 布局切换按钮
     * ==============================
     */


    #theme-example .layout-switcher {

        justify-content: flex-end;

    }



    #theme-example .layout-switcher-btn:focus {

        outline: 2px solid #6b7280;

        outline-offset: 1px;

    }



    /*
     * ==============================
     * 新增文章系列展示功能 - 写作日历热力图
     * ==============================
     */


    #theme-example .cal-cell-empty {

        background-color: #ebedf0;

    }



    .dark #theme-example .cal-cell-empty {

        background-color: #161b22;

    }



    #theme-example .cal-cell-1 {

        background-color: #9be9a8;

    }



    .dark #theme-example .cal-cell-1 {

        background-color: #0e4429;

    }



    #theme-example .cal-cell-2 {

        background-color: #40c463;

    }



    .dark #theme-example .cal-cell-2 {

        background-color: #006d32;

    }



    #theme-example .cal-cell-3 {

        background-color: #30a14e;

    }



    .dark #theme-example .cal-cell-3 {

        background-color: #26a641;

    }



    #theme-example .cal-cell-future {

        background-color: transparent;

    }



    /* 新增文章系列展示功能：当月今天高亮 */
    #theme-example .cal-cell-today {

        background-color: #d1d5db;

    }



    .dark #theme-example .cal-cell-today {

        background-color: #30363d;

    }



    #theme-example .cal-cell-today.cal-cell-1 {

        background-color: #9be9a8;

    }



    #theme-example .cal-cell-today.cal-cell-2 {

        background-color: #40c463;

    }



    #theme-example .cal-cell-today.cal-cell-3 {

        background-color: #30a14e;

    }



    /* 日历导航按钮 */
    #theme-example .cal-nav-btn:focus {

        outline: none;

    }



    /* 日历下拉选择器 */
    #theme-example .cal-select:focus {

        outline: none;

        border-color: #6b7280;

    }


    /* 新增公告时间线功能 */
    #theme-example .notice-timeline {
        position: relative;
        padding: 0.25rem 0;
    }

    #theme-example .notice-timeline-item {
        position: relative;
        display: flex;
        gap: 0.9rem;
        padding-bottom: 1.6rem;
    }

    #theme-example .notice-timeline-item:last-child {
        padding-bottom: 0;
    }

    /* 左侧竖轴 */
    #theme-example .notice-timeline-rail {
        position: relative;
        flex: 0 0 auto;
        width: 14px;
        display: flex;
        justify-content: center;
    }

    #theme-example .notice-timeline-rail::before {
        content: '';
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        top: 18px;
        bottom: -1.6rem;
        width: 2px;
        border-radius: 2px;
        background: linear-gradient(180deg, #e5e7eb, #f3f4f6);
    }

    #theme-example .notice-timeline-item:last-child .notice-timeline-rail::before {
        display: none;
    }

    /* 时间线圆点 */
    #theme-example .notice-timeline-dot {
        position: relative;
        z-index: 1;
        width: 11px;
        height: 11px;
        margin-top: 7px;
        border-radius: 9999px;
        background: #ffffff;
        border: 2px solid #d1d5db;
        box-sizing: border-box;
        transition: all 0.2s ease;
    }

    #theme-example .notice-timeline-dot.is-latest {
        background: #3b82f6;
        border-color: #3b82f6;
        box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.16);
    }

    /* 右侧内容区 */
    #theme-example .notice-timeline-main {
        flex: 1 1 auto;
        min-width: 0;
        padding-bottom: 0.25rem;
    }

    #theme-example .notice-timeline-head {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.45rem;
    }

    #theme-example .notice-timeline-cal {
        font-size: 0.75rem;
        color: #9ca3af;
    }

    #theme-example .notice-timeline-date {
        font-size: 0.95rem;
        font-weight: 600;
        color: #374151;
        letter-spacing: 0.01em;
    }

    #theme-example .notice-timeline-item:first-child .notice-timeline-date {
        color: #2563eb;
    }

    /* 相对日期标签 */
    #theme-example .notice-timeline-badge {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 0.5rem;
        border-radius: 9999px;
        font-size: 0.7rem;
        font-weight: 500;
        line-height: 1;
        color: #6b7280;
        background: #f3f4f6;
        border: 1px solid #e5e7eb;
    }

    #theme-example .notice-timeline-badge.is-new {
        color: #2563eb;
        background: #eff6ff;
        border-color: #bfdbfe;
    }

    /* 内容行 */
    #theme-example .notice-timeline-lines {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    #theme-example .notice-timeline-line {
        margin: 0;
        font-size: 0.95rem;
        line-height: 1.7;
        color: #4b5563;
        word-break: break-word;
    }

    /* 深色模式 */
    .dark #theme-example .notice-timeline-rail::before {
        background: linear-gradient(180deg, #374151, #1f2937);
    }

    .dark #theme-example .notice-timeline-dot {
        background: #111827;
        border-color: #4b5563;
    }

    .dark #theme-example .notice-timeline-dot.is-latest {
        background: #3b82f6;
        border-color: #3b82f6;
    }

    .dark #theme-example .notice-timeline-date {
        color: #e5e7eb;
    }

    .dark #theme-example .notice-timeline-item:first-child .notice-timeline-date {
        color: #60a5fa;
    }

    .dark #theme-example .notice-timeline-badge {
        color: #9ca3af;
        background: #1f2937;
        border-color: #374151;
    }

    .dark #theme-example .notice-timeline-badge.is-new {
        color: #60a5fa;
        background: rgba(37, 99, 235, 0.15);
        border-color: rgba(96, 165, 250, 0.35);
    }

    .dark #theme-example .notice-timeline-line {
        color: #d1d5db;
    }

    /* 移动端适配 */
    @media (max-width: 768px) {
        #theme-example .notice-timeline-item {
            gap: 0.7rem;
            padding-bottom: 1.25rem;
        }

        #theme-example .notice-timeline-rail::before {
            bottom: -1.25rem;
        }

        #theme-example .notice-timeline-date {
            font-size: 0.9rem;
        }

        #theme-example .notice-timeline-line {
            font-size: 0.9rem;
        }
    }

${themeConsoleStyle('example', CONFIG)}


  `}</style>
}

export { Style }
