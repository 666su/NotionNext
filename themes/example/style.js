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

        background-color: black;

    }



    /*
     * ==============================
     * 文章标题
     * ==============================
     *
     * HTML:
     *
     * <div class="px-6 py-4 mb-4 border-b">
     *     <h1 class="text-2xl font-semibold">
     *
     */


    #theme-example .border-b h1 {

        text-align: center !important;

        text-indent: 0 !important;

        width: 100% !important;

    }





    /*
     * ==============================
     * 正文首行缩进
     * ==============================
     *
     * HTML:
     *
     * <div class="notion-text">
     *
     */


    #theme-example .notion-text {

        text-indent: 2em !important;

        line-height: 1.8;

    }





    /*
     * ==============================
     * 特殊内容取消缩进
     * ==============================
     */


    #theme-example .notion-callout,
    #theme-example .notion-code,
    #theme-example .notion-list,
    #theme-example .notion-quote {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 图片说明取消缩进
     * ==============================
     */


    #theme-example .notion-image {

        text-indent: 0 !important;

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
