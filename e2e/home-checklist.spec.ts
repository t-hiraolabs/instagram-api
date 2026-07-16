// ホーム画面の「はじめてガイド」（運用に自信がない・投稿が少ないユーザー向けの
// ハードル型チェックリスト）の回帰テスト。ログイン不要でホームがそのまま開けることを
// 前提に、通常のルート（/）を直接開いて検証する。
import { test, expect } from '@playwright/test';

test.describe('ホームのはじめてガイド', () => {
  test('4項目が表示され、未ログイン状態では未完了になっている', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    await expect(page.getByText('はじめてガイド')).toBeVisible();
    await expect(page.getByText('0/4 完了')).toBeVisible();
    await expect(page.getByText('プロフィールを整える')).toBeVisible();
    await expect(page.getByText('Instagramと連携する')).toBeVisible();
    await expect(page.getByText('AIに投稿ネタを相談してみる')).toBeVisible();
    await expect(page.getByText('最初の投稿を予約する')).toBeVisible();
  });

  test('「プロフィールを整える」をタップするとプロフィール画面に遷移する', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    await page.getByText('プロフィールを整える').click();
    await page.waitForTimeout(800);

    await expect(page.getByText('連携する', { exact: true })).toBeVisible();
  });

  test('「最初の投稿を予約する」をタップすると投稿タブに遷移する', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);

    await page.getByText('最初の投稿を予約する').click();
    await page.waitForTimeout(800);

    await expect(page.getByText('何を投稿しますか？', { exact: true })).toBeVisible();
  });
});
