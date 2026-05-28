import { supabase } from './supabaseClient';

export interface ScheduledPost {
  id: string;
  caption: string;
  hashtags: string[];
  image_url: string | null;
  scheduled_at: string;
  status: 'pending' | 'published' | 'failed';
  type: 'feed' | 'story';
  instagram_user_id: string | null;
  access_token: string | null;
  created_at: string;
}

export interface CreateScheduledPostInput {
  caption: string;
  hashtags: string[];
  image_url?: string;
  scheduled_at: Date;
  type: 'feed' | 'story';
  instagram_user_id?: string;
  access_token?: string;
}

export async function getScheduledPosts(): Promise<ScheduledPost[]> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('*')
    .order('scheduled_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function createScheduledPost(input: CreateScheduledPostInput): Promise<ScheduledPost> {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .insert({
      ...input,
      scheduled_at: input.scheduled_at.toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteScheduledPost(id: string): Promise<void> {
  const { error } = await supabase.from('scheduled_posts').delete().eq('id', id);
  if (error) throw error;
}
