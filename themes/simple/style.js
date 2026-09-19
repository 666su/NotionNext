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
   * 鍩虹璁剧疆
   * ==============================
   */


  // 搴曡壊
  .dark body{
      background-color: black;
  }


  // 鏂囨湰涓嶅彲閫夊彇
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




  /*
   * ==============================
   * 鏂囩珷鏍囬
   * ==============================
   */


  /*
   * Simple涓婚鏂囩珷鏍囬
   *
   * HTML:
   *
   * <div class="px-6 py-4 mb-4 border-b">
   *     <h1 class="text-2xl font-semibold">
   *
   */


  #theme-simple .px-6.py-4.mb-4.border-b h1 {

      text-align: center !important;

      text-indent: 0 !important;

      width: 100% !important;

  }




  /*
   * 闃叉鏍囬鍥炬爣褰卞搷灞呬腑
   */

  #theme-simple .px-6.py-4.mb-4.border-b h1 img {

      display: inline-block;

      vertical-align: middle;

  }





  /*
   * ==============================
   * 姝ｆ枃鎺掔増
   * ==============================
   */


  /*
   * Notion姝ｆ枃:
   *
   * <div class="notion-text">
   *
   */


  #theme-simple .notion-text {

      text-indent: 2em !important;

      line-height: 1.8;

  }




  /*
   * ==============================
   * 鐗规畩妯″潡鍙栨秷缂╄繘
   * ==============================
   */


  #theme-simple .notion-callout {

      text-indent: 0 !important;

  }



  #theme-simple .notion-code {

      text-indent: 0 !important;

  }



  #theme-simple .notion-list {

      text-indent: 0 !important;

  }



  #theme-simple .notion-quote {

      text-indent: 0 !important;

  }





  /*
   * ==============================
   * 鑿滃崟涓嬪垝绾垮姩鐢?
   * ==============================
   */


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





  /*
   * ==============================
   * Simple涓婚閰嶇疆
   * ==============================
   */


  
  /*
    * ==============================
    * 新增文章系列展示功能 - 系列分组样式
    * ==============================
    */


  #theme-simple .series-group {

      padding: 0.5rem;

  }



  #theme-simple .series-group-header {

      position: relative;

  }



  #theme-simple .series-card {

      height: 100%;

  }



  /* 一列模式：大卡片，显示封面 */
  #theme-simple .series-card-large .series-card {

      border-radius: 0.75rem;

  }



  /* 两列模式：中等卡片 */
  #theme-simple .series-card-medium .series-card {

      border-radius: 0.5rem;

  }



  /* 三列模式：小卡片 */
  #theme-simple .series-card-small .series-card {

      border-radius: 0.375rem;

  }



  /* 新增文章系列展示功能：编号徽章内图标与数字严格水平对齐 */
  #theme-simple .series-badge {

      vertical-align: middle;

      line-height: 1;

  }



  #theme-simple .series-badge i {

      display: inline-flex;

      align-items: center;

      justify-content: center;

      line-height: 1;

      font-size: 0.9em;

      position: relative;

      top: -0.5px;

  }



  #theme-simple .series-badge span {

      line-height: 1;

  }



  /* 移动端适配：强制单列 */
  @media (max-width: 640px) {

      #theme-simple .series-grid {

          grid-template-columns: 1fr !important;

      }

  }



  /*
    * ==============================
    * 新增文章系列展示功能 - 布局切换按钮
    * ==============================
    */


  #theme-simple .layout-switcher {

      justify-content: flex-end;

  }



  #theme-simple .layout-switcher-btn:focus {

      outline: 2px solid #3b82f6;

      outline-offset: 1px;

  }


${themeConsoleStyle('simple', CONFIG)}


  `}</style>
}

export { Style }
