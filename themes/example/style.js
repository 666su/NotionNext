/* eslint-disable react/no-unknown-property */
import CONFIG from './config'
import { themeConsoleStyle } from '@/lib/themeConsoleStyle'

/**
 * 此处样式只对当前主题生效
 * 此处不支持tailwindCSS的 @apply 语法
 * @returns
 */
const Style = () => {
  return <style jsx global>{`

    /*
     * ==============================
     * 深色模式
     * ==============================
     */

    .dark body {

        background-color: #0d1117;

    }





    /*
     * ==============================
     * 文章标题居中
     * ==============================
     */

    #theme-example .border-b h1 {

        text-align: center !important;

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 正文首行缩进
     * ==============================
     */


    #theme-example .notion-text {

        text-indent: 2em !important;

        line-height: 1.8;

        margin-bottom: 1em;

    }





    /*
     * ==============================
     * 有序列表 / 无序列表
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
     * Callout取消缩进
     * ==============================
     */


    #theme-example .notion-callout-text .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 引用取消缩进
     * ==============================
     */


    #theme-example .notion-quote .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 代码块取消缩进
     * ==============================
     */


    #theme-example .notion-code .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 图片说明取消缩进
     * ==============================
     */


    #theme-example .notion-image .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 表格取消缩进
     * ==============================
     */


    #theme-example .notion-table .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 分割线
     * ==============================
     */


    #theme-example hr {

        margin-top: 24px;

        margin-bottom: 24px;

    }





    /*
     * ==============================
     * 原主题配置
     * ==============================
     */


    ${themeConsoleStyle('example', CONFIG)}


  `}</style>
}

export { Style }
