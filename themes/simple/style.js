import { css } from '@emotion/react'

export const Style = () => {
  return (
    <style jsx global>{`

      /*
       * ==============================
       * Simple Theme Custom Style
       * ==============================
       */


      /*
       * 页面主体
       */
      #theme-simple {

      }


      /*
       * Notion内容区域
       */
      #theme-simple .notion {
        margin-top: 0 !important;
        margin-bottom: 0 !important;
      }



      /*
       * ==============================
       * 文章标题
       * ==============================
       */


      /*
       * 一级文章标题
       * NotionNext中文章标题实际渲染为 notion-h1
       */
      #theme-simple .notion-h1 {

        /*
         * 标题居中
         */
        text-align: center;

        /*
         * 防止正文缩进影响标题
         */
        text-indent: 0;

        /*
         * 标题间距
         */
        margin-bottom: 1.5rem;

      }



      /*
       * 所有标题取消缩进保护
       */
      #theme-simple .notion-h {

        text-indent: 0;

      }



      /*
       * ==============================
       * 正文排版
       * ==============================
       */


      /*
       * 正文首行缩进
       */
      #theme-simple .notion-text {

        text-indent: 2em;

        line-height: 1.8;

      }



      /*
       * 英文数字保持正常
       */
      #theme-simple .notion-text code {

        text-indent: 0;

      }



      /*
       * ==============================
       * 特殊模块取消缩进
       * ==============================
       */


      /*
       * Callout提示块
       */
      #theme-simple .notion-callout {

        text-indent: 0;

      }



      /*
       * 列表
       */
      #theme-simple .notion-list {

        text-indent: 0;

      }



      /*
       * 引用块
       */
      #theme-simple .notion-quote {

        text-indent: 0;

      }



      /*
       * 代码块
       */
      #theme-simple .notion-code {

        text-indent: 0;

      }



      /*
       * 图片说明
       */
      #theme-simple .notion-image {

        text-indent: 0;

      }



      /*
       * ==============================
       * 正文宽度优化
       * ==============================
       */


      #theme-simple .notion-page-content {

        line-height: 1.8;

      }



      /*
       * 段落之间距离
       */
      #theme-simple .notion-text + .notion-text {

        margin-top: 1rem;

      }



      /*
       * ==============================
       * 移动端适配
       * ==============================
       */

      @media (max-width: 640px) {


        #theme-simple .notion-h1 {

          text-align: left;

        }


        #theme-simple .notion-text {

          text-indent: 2em;

        }


      }



    `}</style>
  )
}
