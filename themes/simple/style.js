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
    /* background-color: #f6f6f6; */
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
   * 文章正文首行缩进
   * 中文博客阅读体验优化
   */
  #theme-simple .notion p {
      text-indent: 2em;
  }


  /*
   * 标题取消缩进
   */
  #theme-simple .notion h1,
  #theme-simple .notion h2,
  #theme-simple .notion h3,
  #theme-simple .notion h4 {
      text-indent: 0;
  }


  /*
   * 列表取消缩进
   */
  #theme-simple .notion ul,
  #theme-simple .notion ol {
      text-indent: 0;
  }


  /*
   * 引用块取消缩进
   */
  #theme-simple .notion blockquote {
      text-indent: 0;
  }


  /*
   * 代码块取消缩进
   */
  #theme-simple .notion pre,
  #theme-simple .notion code {
      text-indent: 0;
  }


  /* 菜单下划线动画 */
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




      ${themeConsoleStyle('simple', CONFIG)}
  `}</style>
}

export { Style }
