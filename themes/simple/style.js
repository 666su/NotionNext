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

  // ==============================
  // 基础
  // ==============================


  // 底色
  .dark body{
      background-color: black;
  }


  // 文本不可选取
  .forbid-copy {
      user-select: none;
      -webkit-user-select: none;
      -ms-user-select: none;
  }



  #theme-simple #announcement-content {

  }



  #theme-simple .blog-item-title {
    color: #276077;
  }



  .dark #theme-simple .blog-item-title {
    color: #d1d5db;
  }



  .notion {

    margin-top: 0 !important;

    margin-bottom: 0 !important;

  }




  // ==============================
  // 文章标题
  // ==============================


  /*
   * Simple主题文章标题
   * 实际DOM:
   * <h2 class="notion-h notion-h1">
   */


  h2.notion-h1 {

      text-align: center !important;

      text-indent: 0 !important;

      width: 100% !important;

  }



  .notion-h {

      text-indent: 0 !important;

  }




  // ==============================
  // 正文
  // ==============================


  /*
   * 正文:
   * <div class="notion-text">
   */


  div.notion-text {

      text-indent: 2em !important;

      line-height: 1.8;

  }





  // ==============================
  // 特殊块取消缩进
  // ==============================


  .notion-callout,
  .notion-code,
  .notion-list,
  .notion-quote {

      text-indent: 0 !important;

  }





  // ==============================
  // 菜单下划线动画
  // ==============================


  #theme-simple .menu-link {

      text-decoration: none;

      background-image: linear-gradient(#dd3333, #dd3333);

      background-repeat: no-repeat;

      background-position: bottom center;

      background-size: 0 2px;

      transition: background-size 100ms ease-in-out;

  }



  #theme-simple .menu-link:hover {

      background-size: 100% 2px;

      color: #dd3333;

      cursor: pointer;

  }




  // ==============================
  // Simple主题原配置
  // ==============================


  ${themeConsoleStyle('simple', CONFIG)}


  `}</style>
}

export { Style }
