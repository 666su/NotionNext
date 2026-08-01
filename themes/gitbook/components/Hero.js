export default function Hero() {
  return (
    <section
      className='max-w-screen-4xl mx-auto px-5 pt-28 pb-10'
    >
      <div
        className='flex items-center justify-between gap-10'
      >

        {/* 左侧 Logo + 博客名称 */}
        <div
          className='flex flex-col items-center w-1/3'
        >

          <img
            src='/images/logo.png'
            className='w-24 h-24 rounded-2xl'
            alt='Jason Logo'
          />

          <h1
            className='mt-5 text-3xl font-bold'
          >
            Jason 的博客
          </h1>

        </div>


        {/* 右侧博客介绍 */}
        <div
          className='w-2/3'
        >

          <h2
            className='text-3xl font-bold leading-relaxed'
          >
            探索芯片设计、
            <br />
            光电传感、
            <br />
            AI 与工程实践
          </h2>


          <p
            className='mt-5 text-gray-500 text-lg'
          >
            记录科研笔记、
            项目实践以及技术成长过程。
          </p>


          <div
            className='mt-5 space-x-3'
          >

            <span
              className='px-4 py-2 bg-gray-100 rounded-full'
            >
              Electronics
            </span>


            <span
              className='px-4 py-2 bg-gray-100 rounded-full'
            >
              IC Design
            </span>


            <span
              className='px-4 py-2 bg-gray-100 rounded-full'
            >
              AI Research
            </span>

          </div>

        </div>


      </div>
    </section>
  )
}
