import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { 
  Database, 
  Trash2,
  RefreshCw, 
  Eye,
  EyeOff,
  Upload,
  BookOpen,
  Headphones,
  PenTool,
  Mic
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface TestPreset {
  id: string;
  module: string;
  topic: string;
  payload: any;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

const MODULE_ICONS: Record<string, any> = {
  reading: BookOpen,
  listening: Headphones,
  writing: PenTool,
  speaking: Mic,
};

const MODULE_COLORS: Record<string, string> = {
  reading: 'bg-blue-500/10 text-blue-600',
  listening: 'bg-purple-500/10 text-purple-600',
  writing: 'bg-emerald-500/10 text-emerald-600',
  speaking: 'bg-orange-500/10 text-orange-600',
};

export default function TestBankAdmin() {
  const [presets, setPresets] = useState<TestPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importModule, setImportModule] = useState('reading');
  const [importTopic, setImportTopic] = useState('');
  const [importing, setImporting] = useState(false);
  const [filterModule, setFilterModule] = useState<string>('all');
  const { toast } = useToast();

  useEffect(() => {
    fetchPresets();
  }, []);

  const fetchPresets = async () => {
    try {
      const { data, error } = await supabase
        .from('test_presets')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPresets(data || []);
    } catch (error) {
      console.error('Error fetching presets:', error);
      toast({
        title: 'Error',
        description: 'Failed to load test presets',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const importPreset = async () => {
    if (!importJson.trim() || !importTopic.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter JSON and topic',
        variant: 'destructive',
      });
      return;
    }

    setImporting(true);
    try {
      const payload = JSON.parse(importJson);

      const { error } = await supabase
        .from('test_presets')
        .insert({
          module: importModule,
          topic: importTopic.trim(),
          payload,
          is_published: false,
        });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Test preset imported successfully',
      });
      setImportJson('');
      setImportTopic('');
      setImportDialogOpen(false);
      fetchPresets();
    } catch (error) {
      console.error('Error importing preset:', error);
      toast({
        title: 'Error',
        description: error instanceof SyntaxError 
          ? 'Invalid JSON format' 
          : 'Failed to import preset',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  const togglePublishStatus = async (id: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('test_presets')
        .update({ is_published: !currentStatus })
        .eq('id', id);

      if (error) throw error;

      setPresets(prev => 
        prev.map(preset => 
          preset.id === id ? { ...preset, is_published: !currentStatus } : preset
        )
      );

      toast({
        title: 'Success',
        description: `Preset ${!currentStatus ? 'published' : 'unpublished'}`,
      });
    } catch (error) {
      console.error('Error toggling publish status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update publish status',
        variant: 'destructive',
      });
    }
  };

  const deletePreset = async (id: string) => {
    try {
      const { error } = await supabase
        .from('test_presets')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setPresets(prev => prev.filter(preset => preset.id !== id));

      toast({
        title: 'Success',
        description: 'Preset deleted',
      });
    } catch (error) {
      console.error('Error deleting preset:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete preset',
        variant: 'destructive',
      });
    }
  };

  const filteredPresets = filterModule === 'all' 
    ? presets 
    : presets.filter(p => p.module === filterModule);

  const publishedCount = presets.filter(p => p.is_published).length;

  return (
    <div className="p-6 bg-gradient-to-br from-background via-background to-primary/5 min-h-full">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-gradient-to-br from-primary to-accent">
            <Database className="w-6 h-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold font-heading">Test Bank</h1>
            <p className="text-muted-foreground">Manage pre-generated test presets for fallback</p>
          </div>
        </div>
      </div>

      {/* Test Presets Section */}
      <Card className="border-0 shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="text-primary" />
              Test Presets
            </CardTitle>
            <CardDescription>
              Pre-generated tests used as fallback when AI generation fails
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={publishedCount > 0 ? 'default' : 'secondary'}>
              {publishedCount} Published
            </Badge>
            <Select value={filterModule} onValueChange={setFilterModule}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="reading">Reading</SelectItem>
                <SelectItem value="listening">Listening</SelectItem>
                <SelectItem value="writing">Writing</SelectItem>
                <SelectItem value="speaking">Speaking</SelectItem>
              </SelectContent>
            </Select>
            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Upload className="w-4 h-4 mr-2" />
                  Import
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Import Test Preset</DialogTitle>
                  <DialogDescription>
                    Paste JSON data to create a new test preset for fallback use
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="module">Module</Label>
                      <Select value={importModule} onValueChange={setImportModule}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="reading">Reading</SelectItem>
                          <SelectItem value="listening">Listening</SelectItem>
                          <SelectItem value="writing">Writing</SelectItem>
                          <SelectItem value="speaking">Speaking</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="topic">Topic</Label>
                      <Input
                        id="topic"
                        placeholder="e.g., Climate Change"
                        value={importTopic}
                        onChange={(e) => setImportTopic(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="json">JSON Payload</Label>
                    <Textarea
                      id="json"
                      placeholder='{"passage": "...", "questionGroups": [...]}'
                      value={importJson}
                      onChange={(e) => setImportJson(e.target.value)}
                      className="font-mono text-sm min-h-[200px]"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={importPreset} disabled={importing}>
                    {importing ? 'Importing...' : 'Import Preset'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredPresets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No test presets found</p>
              <p className="text-sm">Import your first test preset to enable fallback</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead>Topic</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPresets.map((preset) => {
                  const ModuleIcon = MODULE_ICONS[preset.module] || BookOpen;
                  return (
                    <TableRow key={preset.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded ${MODULE_COLORS[preset.module]}`}>
                            <ModuleIcon className="w-4 h-4" />
                          </div>
                          <span className="capitalize">{preset.module}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {preset.topic}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => togglePublishStatus(preset.id, preset.is_published)}
                          className={preset.is_published ? 'text-green-600' : 'text-muted-foreground'}
                        >
                          {preset.is_published ? (
                            <>
                              <Eye className="w-4 h-4 mr-1" />
                              Published
                            </>
                          ) : (
                            <>
                              <EyeOff className="w-4 h-4 mr-1" />
                              Draft
                            </>
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(preset.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Preset?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove this test preset from the fallback pool.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deletePreset(preset.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}