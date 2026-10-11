<template>
  <div class="card mx-auto max-w-lg space-y-4 p-10 text-center">
    <p class="font-display text-7xl font-bold text-primary-ink" aria-hidden="true">404</p>
    <h1 class="h2">{{ $t('common.notFound') }}</h1>
    <RouterLink to="/" class="btn btn-primary">{{ $t('common.goHome') }}</RouterLink>
  </div>
</template>
