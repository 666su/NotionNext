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
     * 文章标题居中
     * ==============================
     *
     * Example主题标题:
     *
     * <h1 class="text-2xl font-semibold">
     *
     */


    #theme-example .border-b h1 {

        text-align: center !important;

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 正文首行缩进
     * ==============================
     *
     * 普通正文:
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
     * Callout取消缩进
     * ==============================
     *
     * 实际结构:
     *
     * <div class="notion-callout-text">
     *
     *     <div class="notion-text">
     *
     *     </div>
     *
     * </div>
     *
     */


    #theme-example .notion-callout-text .notion-text {

        text-indent: 0 !important;

    }





    /*
     * ==============================
     * 列表取消缩进
     * ==============================
     */


    #theme-example .notion-list .notion-text {

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
     * 原主题配置
     * ==============================
     */


    ${themeConsoleStyle('example', CONFIG)}


  `}</style>
}

export { Style }
