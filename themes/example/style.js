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


${themeConsoleStyle('example', CONFIG)}


  `}</style>
}

export { Style }
